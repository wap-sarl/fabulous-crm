import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
// Trigger-wrapped constructor: keeps the lead aggregates in sync (functions.ts).
import { mutation } from '../../_lib/functions';
import type { Doc } from '../../_generated/dataModel';
import { employeeMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import { appOrigin } from '../../lib/config/appUrl';
import {
  createAuditFields,
  updateAuditFields,
  computeChanges,
  logAudit,
} from '../../lib/audit/log';
import { filterUndefined, isNotDeleted } from '../../lib/shared/db';
import { generateHexToken } from '../../lib/security/crypto';
import {
  resolveEmailProvider,
  resolveBrevo,
  isEmailProviderConfigured,
} from '../../lib/email/provider';
import { toBrevoRecipient } from '../../lib/sms/brevo';
import { deleteListMember } from '../../lib/leadLists/members';
import { stampLeadSignal } from '../../lib/leads/signals';
import {
  addressValidator,
  propertyValueValidator,
  marketingConsentChannelValidator,
} from '../../schema';
import {
  loadPropertyDefsById,
  type PropertyDefinitionDoc,
  sanitizeCustomProperties,
} from '../../lib/properties/definitions';
import {
  campaignChannelValidator,
  campaignTrackedLinkValidator,
  messageTypeValidator,
  type CampaignTrackedLink,
} from '../../_lib/validators/crm';
import { buildLeadParams, validateLeadTargetValue } from './leadTargets';
import { leadFilterArgs } from './leadTableFilters';
import { enforceRateLimit } from '../../lib/security/rateLimits';
import {
  assertLifecycleTransition,
  insertLifecycleHistory,
  loadLifecycleConfig,
  planLifecycleTransition,
} from '../../lib/leads/lifecycle';
import { lifecycleStageIndex, type LifecycleConfig } from '../../_lib/validators/lifecycle';
import { requireCompany, resolveCompanyForLead } from '../../lib/companies/lookup';
import { requireValidAddress } from '../../lib/addresses/validation';
import { cleanOwnerIds } from '../../lib/users/owners';
import { dispatchWorkflowTrigger } from '../workflows/triggerDispatch';
import { diffLeadFilterFields } from '../workflows/lib';
import {
  DEFAULT_MAX_DYNAMIC_LISTS,
  validateDynamicListCriteria,
} from '../../_lib/validators/leadLists';
import { leadAdvancedFilterValidator } from '../../_lib/validators/filters';
import { startDynamicListRecalc } from '../../lib/leadLists/dynamic';
import { gateLeadCreate, requireSendAllowed } from '../../lib/extensions/gates';
import {
  applyLeadImport,
  loadLeadImportCaches,
  normalizeEmail,
  planLeadImport,
} from '../../lib/leads/import';
import { leadImportRowValidator } from '../../_lib/validators/imports';

import { CONSENT_TOKEN_BYTES } from '../../lib/leads/import';
// 8 bytes → 16 hex chars: short enough for SMS, ample for a low-value target.
const TRACKED_LINK_TOKEN_BYTES = 8;

// Params injected for every recipient: tracked-link keys may not shadow them.
const RESERVED_PARAM_KEYS = new Set([
  'firstName',
  'lastName',
  'email',
  'phone',
  'status',
  'comment',
  'address',
  'consentUrl',
]);

/** Marketing consent is absent on purpose: it is RGPD data the lead controls, set only through the public consent link, never by an authenticated path. */
const leadRowArgs = {
  firstName: v.string(),
  lastName: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(addressValidator),
  comment: v.optional(v.string()),
  ownerIds: v.optional(v.array(v.id('users'))),
  isRedFlagged: v.optional(v.boolean()),
  // A stage key from appConfig.lifecycle; defaults to the configured stage.
  lifecycleStage: v.optional(v.string()),
  companyId: v.optional(v.id('companies')),
  company: v.optional(
    v.object({
      name: v.optional(v.string()),
      country: v.optional(v.string()),
      registrationNumber: v.optional(v.string()),
      vatNumber: v.optional(v.string()),
      domain: v.optional(v.string()),
    }),
  ),
} as const;

function initialLifecycleStage(config: LifecycleConfig, requested: string | undefined): string {
  if (requested === undefined) return config.defaultStage;
  if (lifecycleStageIndex(config, requested) === -1) throw new Error('unknown_lifecycle_stage');
  return requested;
}

export const createLead = employeeMutation({
  args: {
    ...leadRowArgs,
    customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
  },
  handler: async (ctx, args) => {
    const customProperties = sanitizeCustomProperties(
      await loadPropertyDefsById(ctx, 'lead'),
      args.customProperties,
    );
    const lifecycle = await loadLifecycleConfig(ctx);
    const lifecycleStage = initialLifecycleStage(lifecycle, args.lifecycleStage);
    const email = normalizeEmail(args.email);
    let companyId = args.companyId;
    if (companyId) await requireCompany(ctx, companyId);
    else if (args.company) {
      companyId =
        (await resolveCompanyForLead(ctx, args.company, undefined, { userId: ctx.userId })) ??
        undefined;
    }

    await gateLeadCreate(ctx, 1, 'crm');
    const leadId = await ctx.db.insert('leads', {
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      email,
      phone: args.phone?.trim() || undefined,
      address: requireValidAddress(args.address),
      // Consent starts empty; only the lead can grant it via the public link.
      marketingConsent: [],
      consentToken: generateHexToken(CONSENT_TOKEN_BYTES),
      comment: args.comment,
      ownerIds: await cleanOwnerIds(ctx, args.ownerIds ?? []),
      companyId,
      isRedFlagged: args.isRedFlagged ?? false,
      lifecycleStage,
      customProperties,
      ...createAuditFields(ctx.userId),
    });
    // The audit entry first, whatever else the write records: afterChange consumers see `create` before the rest.
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'lead',
      entityId: leadId,
      action: 'create',
    });
    await insertLifecycleHistory(
      ctx,
      leadId,
      { from: undefined, to: lifecycleStage },
      { source: 'manual', changedBy: ctx.userId },
    );

    await dispatchWorkflowTrigger(ctx, leadId, { type: 'lead_created' });

    return leadId;
  },
});

export const updateLead = employeeMutation({
  args: {
    leadId: v.id('leads'),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(addressValidator),
    comment: v.optional(v.string()),
    ownerIds: v.optional(v.array(v.id('users'))),
    isRedFlagged: v.optional(v.boolean()),
    // A blocked regression fails the whole update with `lifecycle_regression_blocked`.
    lifecycleStage: v.optional(v.string()),
    companyId: v.optional(v.union(v.id('companies'), v.null())),
    customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
  },
  handler: async (ctx, args) => {
    // Marketing consent is not an accepted field: it is RGPD data the lead controls, changed only through the public consent link.
    const { leadId, email, customProperties, lifecycleStage, companyId, ...rest } = args;
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt != null) {
      throw new Error('lead_not_found');
    }

    const updates: Record<string, unknown> = { ...rest };
    requireValidAddress(rest.address);
    if (email !== undefined) {
      updates.email = normalizeEmail(email);
    }
    // The company only changes on an explicit pick: a new business email never attaches one by itself.
    if (companyId !== undefined) {
      if (companyId) await requireCompany(ctx, companyId);
      // filterUndefined keeps null; patching null clears the field below.
      updates.companyId = companyId;
    }
    if (customProperties !== undefined) {
      updates.customProperties = sanitizeCustomProperties(
        await loadPropertyDefsById(ctx, 'lead'),
        customProperties,
      );
    }
    let lifecycleChange: { from: string | undefined; to: string } | undefined;
    if (lifecycleStage !== undefined) {
      const plan = planLifecycleTransition(await loadLifecycleConfig(ctx), lead, lifecycleStage);
      assertLifecycleTransition(plan);
      if (plan.kind === 'change') {
        lifecycleChange = plan;
        updates.lifecycleStage = plan.to;
      }
    }

    const filtered = filterUndefined(updates);
    const changes = computeChanges(lead, filtered);
    await ctx.db.patch(leadId, {
      ...filtered,
      // `companyId: null` (detach) must reach the patch as undefined to remove the field.
      ...(filtered.companyId === null ? { companyId: undefined } : {}),
      ...updateAuditFields(ctx.userId),
    });
    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'lead',
        entityId: leadId,
        action: 'update',
        metadata: { changes },
      });
    }
    if (lifecycleChange) {
      await insertLifecycleHistory(ctx, leadId, lifecycleChange, {
        source: 'manual',
        changedBy: ctx.userId,
      });
    }

    if (changes) {
      const changedFields = diffLeadFilterFields(lead, filtered);
      if (changedFields.length > 0) {
        await dispatchWorkflowTrigger(ctx, leadId, {
          type: 'lead_property_changed',
          changedFields,
        });
      }
    }

    return leadId;
  },
});

export const deleteLead = employeeMutation({
  args: { leadId: v.id('leads') },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt != null) {
      throw new Error('lead_not_found');
    }
    await ctx.db.patch(args.leadId, {
      deletedAt: Date.now(),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'lead',
      entityId: args.leadId,
      action: 'delete',
    });
  },
});

/** Missing or already deleted ids are skipped silently rather than aborting the batch. */
export const deleteLeads = employeeMutation({
  args: { leadIds: v.array(v.id('leads')) },
  handler: async (ctx, args) => {
    const uniqueIds = [...new Set(args.leadIds)];
    let deleted = 0;
    for (const leadId of uniqueIds) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.deletedAt != null) continue;
      await ctx.db.patch(leadId, {
        deletedAt: Date.now(),
        ...updateAuditFields(ctx.userId),
      });
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'lead',
        entityId: leadId,
        action: 'delete',
      });
      deleted++;
    }
    return { deleted };
  },
});

/** Upsert by normalized email: a match is updated in place and revived if soft-deleted, a row without an email is always inserted. */
export const importLeads = employeeMutation({
  args: {
    rows: v.array(
      v.object({
        ...leadImportRowValidator.fields,
        // Existing lead this row updates, picked from the duplicate preview.
        matchLeadId: v.optional(v.id('leads')),
      }),
    ),
    // Optional list every imported (created OR updated) lead is added to.
    listId: v.optional(v.id('leadLists')),
  },
  handler: async (ctx, args) => {
    if (args.listId) {
      const list = await ctx.db.get(args.listId);
      if (!list) throw new Error('list_not_found');
      if (list.kind === 'dynamic') throw new Error('list_is_dynamic');
    }
    const errors: { index: number; error: string }[] = [];
    let created = 0;
    let updated = 0;
    const caches = await loadLeadImportCaches(ctx);
    // Every row counts, updates and invalid rows included: no matching pass before the gate, by decision.
    await gateLeadCreate(ctx, args.rows.length, 'import');
    for (let index = 0; index < args.rows.length; index++) {
      const { matchLeadId, ...row } = args.rows[index];
      const plan = await planLeadImport(ctx, row, caches, {
        matchId: matchLeadId,
        detectDuplicates: false,
      });
      const result =
        plan.kind === 'error'
          ? plan
          : await applyLeadImport(ctx, row, plan, caches, {
              userId: ctx.userId,
              listId: args.listId,
            });
      if (result.kind === 'error') errors.push({ index, error: result.error });
      else if (result.kind === 'created') created++;
      else updated++;
    }
    return { created, updated, errors };
  },
});

export const createLeadList = employeeMutation({
  args: {
    name: v.string(),
    kind: v.optional(v.union(v.literal('static'), v.literal('dynamic'))),
    criteria: v.optional(leadAdvancedFilterValidator),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error('Le nom de la liste est requis.');
    const kind = args.kind ?? 'static';

    if (kind === 'dynamic') {
      const error = validateDynamicListCriteria(args.criteria);
      if (error) throw new Error(error);
      const lists = await ctx.db.query('leadLists').collect();
      const cfg = await ctx.db.query('appConfig').first();
      const cap = cfg?.lists?.maxDynamicLists ?? DEFAULT_MAX_DYNAMIC_LISTS;
      if (lists.filter((l) => l.kind === 'dynamic').length >= cap) {
        throw new Error('dynamic_list_cap_reached');
      }
    } else if (args.criteria) {
      throw new Error('list_not_dynamic');
    }

    const listId = await ctx.db.insert('leadLists', {
      name,
      ...(kind === 'dynamic' && { kind, criteria: args.criteria }),
      ...createAuditFields(ctx.userId),
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadList',
      entityId: listId,
      action: 'create',
      metadata: { kind },
    });

    if (kind === 'dynamic') {
      const list = await ctx.db.get(listId);
      if (list) await startDynamicListRecalc(ctx, list);
    }
    return listId;
  },
});

export const updateLeadList = employeeMutation({
  args: {
    listId: v.id('leadLists'),
    name: v.optional(v.string()),
    criteria: v.optional(leadAdvancedFilterValidator),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error('list_not_found');

    const name = args.name?.trim();
    if (name !== undefined && !name) throw new Error('Le nom de la liste est requis.');
    if (args.criteria) {
      if (list.kind !== 'dynamic') throw new Error('list_not_dynamic');
      const error = validateDynamicListCriteria(args.criteria);
      if (error) throw new Error(error);
    }

    await ctx.db.patch(args.listId, {
      ...(name !== undefined && { name }),
      ...(args.criteria !== undefined && { criteria: args.criteria }),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadList',
      entityId: args.listId,
      action: 'update',
      metadata: { criteriaChanged: args.criteria !== undefined },
    });

    if (args.criteria !== undefined) {
      const fresh = await ctx.db.get(args.listId);
      if (fresh) await startDynamicListRecalc(ctx, fresh);
    }
  },
});

export const recalcLeadList = employeeMutation({
  args: { listId: v.id('leadLists') },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error('list_not_found');
    if (list.kind !== 'dynamic') throw new Error('list_not_dynamic');
    await startDynamicListRecalc(ctx, list);
  },
});

// Each cascade-deleted lead writes up to 3 docs plus a few aggregate nodes: 200 members stay well under Convex's per-transaction write cap.
const LIST_DELETE_BATCH = 200;

/** Members go in bounded batches to stay under Convex's per-transaction limits: the client calls again until `done`, when the list itself is removed. */
export const deleteLeadList = employeeMutation({
  args: { listId: v.id('leadLists'), deleteLeads: v.boolean() },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return { done: true as const, deletedLeads: 0 };
    if (list.nextRecalcId) {
      await ctx.scheduler.cancel(list.nextRecalcId);
      await ctx.db.patch(args.listId, { nextRecalcId: undefined, recalc: undefined });
    }

    const members = await ctx.db
      .query('leadListMembers')
      .withIndex('by_list_lead', (q) => q.eq('listId', args.listId))
      .take(LIST_DELETE_BATCH);

    let deletedLeads = 0;
    for (const member of members) {
      // Junction row first: the soft-delete trigger below would otherwise delete it too.
      await deleteListMember(ctx, member);
      if (args.deleteLeads) {
        const lead = await ctx.db.get(member.leadId);
        if (lead && lead.deletedAt == null) {
          await ctx.db.patch(member.leadId, {
            deletedAt: Date.now(),
            ...updateAuditFields(ctx.userId),
          });
          await logAudit({
            ctx,
            userId: ctx.userId,
            entityType: 'lead',
            entityId: member.leadId,
            action: 'delete',
          });
          deletedLeads++;
        }
      }
    }

    // More members remain — signal the client to call again.
    if (members.length === LIST_DELETE_BATCH) {
      return { done: false as const, deletedLeads };
    }

    // All members processed: remove the list itself.
    await ctx.db.delete(args.listId);
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadList',
      entityId: args.listId,
      action: 'delete',
    });
    return { done: true as const, deletedLeads };
  },
});

export const createNote = employeeMutation({
  args: {
    leadId: v.id('leads'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) {
      throw new Error('lead_not_found');
    }
    const content = args.content.trim();
    if (!content) {
      throw new Error('empty_note');
    }

    const noteId = await ctx.db.insert('leadNotes', {
      leadId: args.leadId,
      content,
      isPinned: false,
      ...createAuditFields(ctx.userId),
    });
    await stampLeadSignal(ctx, args.leadId, 'activity', Date.now());

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadNote',
      entityId: noteId,
      action: 'create',
    });

    return noteId;
  },
});

/** Edit a note's text in place. */
export const updateNote = employeeMutation({
  args: {
    noteId: v.id('leadNotes'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note || !isNotDeleted(note)) {
      throw new Error('note_not_found');
    }
    const content = args.content.trim();
    if (!content) {
      throw new Error('empty_note');
    }

    const updates = { content };
    const changes = computeChanges(note, updates);
    await ctx.db.patch(args.noteId, { ...updates, ...updateAuditFields(ctx.userId) });

    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'leadNote',
        entityId: args.noteId,
        action: 'update',
        metadata: { changes },
      });
    }

    return args.noteId;
  },
});

/** Pin or unpin a note (idempotent — explicit boolean rather than a toggle). */
export const setNotePinned = employeeMutation({
  args: {
    noteId: v.id('leadNotes'),
    isPinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note || !isNotDeleted(note)) {
      throw new Error('note_not_found');
    }

    const updates = { isPinned: args.isPinned };
    const changes = computeChanges(note, updates);
    await ctx.db.patch(args.noteId, { ...updates, ...updateAuditFields(ctx.userId) });

    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'leadNote',
        entityId: args.noteId,
        action: 'update',
        metadata: { changes },
      });
    }

    return args.noteId;
  },
});

/** Soft-delete a note. */
export const deleteNote = employeeMutation({
  args: { noteId: v.id('leadNotes') },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note || !isNotDeleted(note)) {
      throw new Error('note_not_found');
    }
    await ctx.db.patch(args.noteId, {
      deletedAt: Date.now(),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadNote',
      entityId: args.noteId,
      action: 'delete',
    });
  },
});

/** Pure, the caller inserts the rows (the tokens need the send id); shared with the resend mutations so a re-materialized send has the shape of a fresh one. */
export function buildSendParams(
  lead: Doc<'leads'>,
  opts: {
    trackedLinks: CampaignTrackedLink[];
    defsById: Map<string, PropertyDefinitionDoc>;
    consentBase: string;
    linkBase: string | undefined;
    lifecycle: LifecycleConfig;
  },
): { params: Record<string, string>; tokens: { linkKey: string; token: string }[] } {
  const params = buildLeadParams(lead, opts.defsById, opts.consentBase, opts.lifecycle);
  // One fresh token per (recipient × tracked link); the URL is injected into params.
  const tokens = opts.trackedLinks.map((link) => {
    const token = generateHexToken(TRACKED_LINK_TOKEN_BYTES);
    params[link.key] = `${opts.linkBase}/l/${token}`;
    return { linkKey: link.key, token };
  });
  return { params, tokens };
}

export const createCampaign = employeeMutation({
  args: {
    name: v.string(),
    channel: campaignChannelValidator,
    // A filter, resolved server-side in batches: an explicit id array would cap recipients at Convex's 8,192-element array limit.
    filter: v.object(leadFilterArgs),
    // Exactly one email mode is provided: brevoTemplateId for a template, subject + htmlBody for a custom email.
    brevoTemplateId: v.optional(v.number()),
    subject: v.optional(v.string()),
    htmlBody: v.optional(v.string()),
    // SMS content.
    smsBody: v.optional(v.string()),
    // Marketing vs transactional; applies to both channels. Default marketing.
    messageType: v.optional(messageTypeValidator),
    // Tracked links authored in the composer (unique per-recipient URLs).
    trackedLinks: v.optional(v.array(campaignTrackedLinkValidator)),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error('Le nom de la campagne est requis.');

    const messageType = args.messageType ?? 'marketing';

    // Channels and modes the configured provider cannot serve are rejected up front.
    const cfg = await ctx.db.query('appConfig').first();
    const provider = await resolveEmailProvider(cfg);
    const emailProvider = provider.kind;
    const smsAvailable = (await resolveBrevo(cfg)).smsAvailable;

    // Custom-property definitions are substituted as {{ params.custom_<id> }} and referenced by tracked links.
    const defsById = await loadPropertyDefsById(ctx, 'lead');

    // Validate tracked links up front (keys, target field/property, value, redirect).
    const trackedLinks = args.trackedLinks ?? [];
    const linkKeys = new Set<string>();
    for (const link of trackedLinks) {
      if (
        !/^\w+$/.test(link.key) ||
        RESERVED_PARAM_KEYS.has(link.key) ||
        link.key.startsWith('custom_')
      ) {
        throw new Error(`Clé de lien de suivi invalide : ${link.key}`);
      }
      if (linkKeys.has(link.key)) throw new Error(`Clé de lien de suivi en double : ${link.key}`);
      linkKeys.add(link.key);

      const valueError = validateLeadTargetValue(link.target, link.value, defsById);
      if (valueError) throw new Error(`Lien « ${link.label} » : ${valueError}`);

      if (link.redirectUrl !== undefined && !/^https?:\/\//.test(link.redirectUrl)) {
        throw new Error(
          `Lien « ${link.label} » : l'URL de redirection doit commencer par http(s)://`,
        );
      }
    }
    const linkBase = process.env.CONVEX_SITE_URL;
    if (trackedLinks.length > 0 && !linkBase) {
      throw new Error('CONVEX_SITE_URL manquant : impossible de générer les liens de suivi.');
    }

    // Resolve and validate the content fields for the chosen channel/mode.
    let brevoTemplateId: number | undefined;
    let subject: string | undefined;
    let htmlBody: string | undefined;
    let smsBody: string | undefined;

    if (args.channel === 'sms') {
      // SMS is Brevo-only, independent of the email provider.
      if (!smsAvailable) {
        throw new Error('Les campagnes SMS nécessitent un compte Brevo configuré.');
      }
      smsBody = args.smsBody?.trim();
      if (!smsBody) throw new Error('Le message SMS est requis.');
    } else {
      // Without a usable provider (Brevo key or SMTP host) the campaign would silently never send.
      if (!isEmailProviderConfigured(provider)) {
        throw new Error(
          "Aucun fournisseur d'e-mail n'est configuré. Configurez Brevo ou SMTP dans Paramètres → E-mail.",
        );
      }
      const customHtml = args.htmlBody?.trim();
      if (customHtml) {
        // Custom (WYSIWYG) email: a subject is required.
        subject = args.subject?.trim();
        if (!subject) throw new Error('L’objet de l’e-mail est requis.');
        htmlBody = customHtml;
      } else {
        // Brevo merges a template server-side, so templates are unavailable under SMTP.
        if (emailProvider === 'smtp') {
          throw new Error(
            'Les modèles Brevo ne sont pas disponibles en mode SMTP. Utilisez un e-mail personnalisé.',
          );
        }
        // Template email: a positive integer Brevo template id is required.
        if (
          !args.brevoTemplateId ||
          !Number.isInteger(args.brevoTemplateId) ||
          args.brevoTemplateId <= 0
        ) {
          throw new Error('ID de template Brevo invalide.');
        }
        brevoTemplateId = args.brevoTemplateId;
      }
    }

    // Early gate: an exhausted allowance refuses before any recipient is materialised.
    await requireSendAllowed(ctx, {
      source: 'campaign',
      channel: args.channel,
      count: 1,
      stage: 'create',
    });
    const campaignId = await ctx.db.insert('campaigns', {
      name,
      brevoTemplateId,
      subject,
      htmlBody,
      smsBody,
      messageType,
      channel: args.channel,
      // A snapshot, so analytics degrade correctly even if the admin later switches providers.
      emailProvider: args.channel === 'email' ? emailProvider : undefined,
      trackedLinks: trackedLinks.length > 0 ? trackedLinks : undefined,
      status: 'preparing',
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      ...createAuditFields(ctx.userId),
    });

    // Recipients are materialised in scheduled batches: one transaction caps at 8,192 writes, exceeded around 2,000 recipients with 3 tracked links.
    await ctx.scheduler.runAfter(0, internal.features.crm.internal.prepareCampaignBatch, {
      campaignId,
      filter: args.filter,
    });

    return campaignId;
  },
});

/** Guards the resends, with the messages of createCampaign: a retry never resets rows into a provider that is silently unconfigured. */
async function assertChannelDeliverable(
  cfg: Doc<'appConfig'> | null,
  channel: 'email' | 'sms',
): Promise<void> {
  if (channel === 'sms') {
    if (!(await resolveBrevo(cfg)).smsAvailable) {
      throw new Error('Les campagnes SMS nécessitent un compte Brevo configuré.');
    }
  } else if (!isEmailProviderConfigured(await resolveEmailProvider(cfg))) {
    throw new Error(
      "Aucun fournisseur d'e-mail n'est configuré. Configurez Brevo ou SMTP dans Paramètres → E-mail.",
    );
  }
}

/** Shared context for (re-)materializing a campaign's sends on resend. */
async function loadResendContext(ctx: MutationCtx, campaign: Doc<'campaigns'>) {
  const trackedLinks = campaign.trackedLinks ?? [];
  const linkBase = process.env.CONVEX_SITE_URL;
  if (trackedLinks.length > 0 && !linkBase) throw new Error('link_base_missing');
  return {
    isSms: (campaign.channel ?? 'email') === 'sms',
    trackedLinks,
    defsById: await loadPropertyDefsById(ctx, 'lead'),
    consentBase: appOrigin() || 'http://localhost:4202',
    linkBase,
    lifecycle: await loadLifecycleConfig(ctx),
  };
}

/** Sent and failed rows keep their contact and tokens, skipped rows never had any and get fresh ones; false when the lead still has no contact. */
async function requeueSend(
  ctx: MutationCtx,
  send: Doc<'campaignSends'>,
  remat: {
    isSms: boolean;
    trackedLinks: CampaignTrackedLink[];
    defsById: Map<string, PropertyDefinitionDoc>;
    consentBase: string;
    linkBase: string | undefined;
    lifecycle: LifecycleConfig;
  },
): Promise<boolean> {
  // Clear the previous send's outcome + engagement so stats reflect the new send.
  const reset = {
    status: 'pending' as const,
    error: undefined,
    brevoMessageId: undefined,
    openedAt: undefined,
    clickedAt: undefined,
    sentAt: undefined,
  };
  if (send.status === 'skipped_no_email' || send.status === 'skipped_no_phone') {
    const lead = await ctx.db.get(send.leadId);
    const contact =
      lead && lead.deletedAt == null ? (remat.isSms ? lead.phone : lead.email) : undefined;
    if (!lead || !contact) return false;
    const { params, tokens } = buildSendParams(lead, remat);
    await ctx.db.patch(send._id, {
      ...reset,
      email: remat.isSms ? undefined : contact,
      phone: remat.isSms ? contact : undefined,
      smsRecipient: remat.isSms ? (toBrevoRecipient(contact) ?? undefined) : undefined,
      params,
    });
    for (const { linkKey, token } of tokens) {
      await ctx.db.insert('campaignLinkTokens', {
        token,
        campaignId: send.campaignId,
        sendId: send._id,
        leadId: lead._id,
        linkKey,
      });
    }
  } else {
    await ctx.db.patch(send._id, reset);
  }
  return true;
}

/** Resends one recipient whatever its status, except `pending`: that row is already queued. */
export const retryCampaignSend = employeeMutation({
  args: { campaignId: v.id('campaigns'), sendId: v.id('campaignSends') },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send || send.campaignId !== args.campaignId) throw new Error('send_not_found');
    if (send.status === 'pending') throw new Error('send_pending');

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error('campaign_not_found');
    // A drain is already running; its own loop will process pending rows.
    if (campaign.status === 'sending') throw new Error('campaign_sending');

    const cfg = await ctx.db.query('appConfig').first();
    await assertChannelDeliverable(cfg, campaign.channel ?? 'email');

    const remat = await loadResendContext(ctx, campaign);
    if (!(await requeueSend(ctx, send, remat))) throw new Error('no_contact');
    await requireSendAllowed(ctx, {
      source: 'campaign',
      channel: campaign.channel ?? 'email',
      count: 1,
      stage: 'resend',
    });

    // `sent` was counted in sentCount; `failed` and `skipped_*` in failedCount.
    await ctx.db.patch(args.campaignId, {
      sentCount: Math.max(0, campaign.sentCount - (send.status === 'sent' ? 1 : 0)),
      failedCount: Math.max(0, campaign.failedCount - (send.status === 'sent' ? 0 : 1)),
      status: 'sending',
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAfter(0, internal.features.crm.actions.sendCampaignBatch, {
      campaignId: args.campaignId,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: 'resend_send', sendId: args.sendId },
    });
  },
});

/** Resends to every deliverable recipient, those who already received it included; counters are reset because the drain tallies them again. */
export const resendAllCampaignSends = employeeMutation({
  args: { campaignId: v.id('campaigns') },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error('campaign_not_found');
    if (campaign.status === 'sending') throw new Error('campaign_sending');

    const cfg = await ctx.db.query('appConfig').first();
    await assertChannelDeliverable(cfg, campaign.channel ?? 'email');

    const remat = await loadResendContext(ctx, campaign);
    const sends = await ctx.db
      .query('campaignSends')
      .withIndex('by_campaign', (q) => q.eq('campaignId', args.campaignId))
      .collect();

    let resent = 0;
    let stillSkipped = 0;
    for (const send of sends) {
      if (await requeueSend(ctx, send, remat)) resent++;
      else stillSkipped++;
    }
    if (resent === 0) return { resent: 0 };
    await requireSendAllowed(ctx, {
      source: 'campaign',
      channel: campaign.channel ?? 'email',
      count: resent,
      stage: 'resend',
    });

    await ctx.db.patch(args.campaignId, {
      sentCount: 0,
      failedCount: stillSkipped,
      status: 'sending',
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAfter(0, internal.features.crm.actions.sendCampaignBatch, {
      campaignId: args.campaignId,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: 'resend_all', count: resent },
    });

    return { resent };
  },
});

/** PUBLIC (no auth): the consent token is the only credential, for the unauthenticated RGPD consent page. */
export const updateConsentByToken = mutation({
  args: {
    token: v.string(),
    channels: v.array(marketingConsentChannelValidator),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db
      .query('leads')
      .withIndex('by_consentToken', (q) => q.eq('consentToken', args.token))
      .first();
    if (!lead || lead.deletedAt != null) {
      // Global enumeration guard: invalid tokens share one small bucket.
      const ok = await enforceRateLimit(ctx, 'consentInvalid');
      return {
        success: false as const,
        error: ok ? ('invalid_token' as const) : ('rate_limited' as const),
      };
    }
    if (!(await enforceRateLimit(ctx, 'consentUpdate', args.token))) {
      return { success: false as const, error: 'rate_limited' };
    }

    const channels = [...new Set(args.channels)];
    await ctx.db.patch(lead._id, {
      marketingConsent: channels,
      consentUpdatedAt: Date.now(),
      consentSource: 'public_link',
      updatedAt: Date.now(),
    });
    // Re-submitting the same choice changes nothing worth reporting.
    const changes = computeChanges(lead, { marketingConsent: channels });
    if (changes) {
      await logAudit({
        ctx,
        entityType: 'lead',
        entityId: lead._id,
        action: 'update',
        metadata: { source: 'public_link', changes },
      });
    }

    await dispatchWorkflowTrigger(ctx, lead._id, { type: 'consent_updated' });

    return { success: true as const };
  },
});
