import { v } from 'convex/values';
import { mutation, type MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { employeeMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import {
  appOrigin,
  createAuditFields,
  updateAuditFields,
  computeChanges,
  filterUndefined,
  isNotDeleted,
  logAudit,
  generateHexToken,
  resolveEmailProvider,
  resolveBrevo,
  isEmailProviderConfigured,
  toBrevoRecipient,
} from '../../lib';
import {
  addressValidator,
  leadStatusValidator,
  leadPropertyValueValidator,
  marketingConsentChannelValidator,
} from '../../schema';
import {
  validateLeadPropertyValue,
  type LeadPropertyValue,
} from '../../_lib/validators/leadProperties';
import {
  campaignChannelValidator,
  campaignTrackedLinkValidator,
  messageTypeValidator,
  type CampaignTrackedLink,
} from '../../_lib/validators/crm';
import { buildLeadParams, validateLeadTargetValue } from './leadTargets';
import { dispatchWorkflowTrigger, loadActiveWorkflows } from '../workflows/triggerDispatch';
import { diffLeadFilterFields } from '../workflows/lib';

const CONSENT_TOKEN_BYTES = 24;
// 8 bytes → 16 hex chars: short enough for SMS, ample for a low-value target.
const TRACKED_LINK_TOKEN_BYTES = 8;

// Params injected for every recipient (see the loop in createCampaign);
// tracked-link keys may not shadow them.
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

/**
 * Keep only custom-property values that reference a live definition and whose
 * value matches that definition's type (select/radio → a known option value,
 * checkbox → an array of known option values, date → string, etc.). Mismatched
 * or orphaned entries are dropped. Surviving values are then checked against the
 * definition's validation rules (number range, text length/pattern, email
 * format) and a failure throws — the client normally blocks first, this is the
 * server-side safety net.
 */
type LeadPropertyDef = Doc<'leadPropertyDefinitions'>;

/** Load the active custom-property definitions once, keyed by id. */
async function loadPropertyDefsById(ctx: MutationCtx): Promise<Map<string, LeadPropertyDef>> {
  const defs = (await ctx.db.query('leadPropertyDefinitions').collect()).filter(isNotDeleted);
  return new Map(defs.map((d) => [d._id as string, d]));
}

/**
 * Core of {@link sanitizeCustomProperties} that reuses an already-loaded
 * definitions map — lets the bulk import load the (tiny) definitions table once
 * per chunk instead of once per row.
 */
function sanitizeCustomPropertiesWith(
  byId: Map<string, LeadPropertyDef>,
  raw: Record<string, LeadPropertyValue> | undefined
): Record<string, LeadPropertyValue> | undefined {
  if (!raw) return undefined;

  const clean: Record<string, LeadPropertyValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    const def = byId.get(key);
    if (!def) continue;
    const optionValues = new Set((def.options ?? []).map((o) => o.value));

    switch (def.type) {
      case 'text':
      case 'email':
      case 'date':
        if (typeof value === 'string' && value.length > 0) clean[key] = value;
        break;
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
        break;
      case 'boolean':
        if (typeof value === 'boolean') clean[key] = value;
        break;
      case 'select':
      case 'radio':
        if (typeof value === 'string' && optionValues.has(value)) clean[key] = value;
        break;
      case 'checkbox': {
        if (Array.isArray(value)) {
          const picked = value.filter((v) => typeof v === 'string' && optionValues.has(v));
          if (picked.length > 0) clean[key] = picked;
        }
        break;
      }
    }

    if (clean[key] !== undefined) {
      const error = validateLeadPropertyValue(def, clean[key]);
      if (error) throw new Error(`invalid_property_value: ${def.label}: ${error}`);
    }
  }
  return clean;
}

/** Load definitions and sanitize a single lead's custom-property values. */
async function sanitizeCustomProperties(
  ctx: MutationCtx,
  raw: Record<string, LeadPropertyValue> | undefined
): Promise<Record<string, LeadPropertyValue> | undefined> {
  if (!raw) return undefined;
  return sanitizeCustomPropertiesWith(await loadPropertyDefsById(ctx), raw);
}

/**
 * Add a lead to a list if it isn't already a member. Idempotent across import
 * chunks and re-imported emails (same lead appearing in several chunks).
 */
async function addLeadToList(
  ctx: MutationCtx,
  listId: Id<'leadLists'>,
  leadId: Id<'leads'>,
  userId: Id<'users'>,
  workflows?: Doc<'workflows'>[]
): Promise<void> {
  const existing = await ctx.db
    .query('leadListMembers')
    .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', leadId))
    .first();
  if (existing) return;
  await ctx.db.insert('leadListMembers', { listId, leadId, addedBy: userId });
  await dispatchWorkflowTrigger(
    ctx,
    leadId,
    { type: 'list_membership_changed', change: 'added', listId },
    { workflows }
  );
}

/** Emails are stored lowercased so the import upsert can match on them. */
function normalizeEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().toLowerCase();
  return email || undefined;
}

/**
 * Shared field validators for a full lead, used by createLead and importLeads.
 * Marketing consent is intentionally absent: it is RGPD data the lead controls
 * and can only be changed through the public consent link (updateConsentByToken).
 * No authenticated path may set it — the validator simply doesn't accept it.
 */
const leadRowArgs = {
  firstName: v.string(),
  lastName: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(addressValidator),
  comment: v.optional(v.string()),
  assignedTo: v.optional(v.id('users')),
  isRedFlagged: v.optional(v.boolean()),
  status: v.optional(leadStatusValidator),
} as const;

export const createLead = employeeMutation({
  args: {
    ...leadRowArgs,
    customProperties: v.optional(v.record(v.string(), leadPropertyValueValidator)),
  },
  handler: async (ctx, args) => {
    const customProperties = await sanitizeCustomProperties(ctx, args.customProperties);

    const leadId = await ctx.db.insert('leads', {
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      email: normalizeEmail(args.email),
      phone: args.phone?.trim() || undefined,
      address: args.address,
      // Consent starts empty; only the lead can grant it via the public link.
      marketingConsent: [],
      consentToken: generateHexToken(CONSENT_TOKEN_BYTES),
      comment: args.comment,
      assignedTo: args.assignedTo,
      isRedFlagged: args.isRedFlagged ?? false,
      status: args.status ?? 'nouveau',
      customProperties,
      ...createAuditFields(ctx.userId),
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'lead',
      entityId: leadId,
      action: 'create',
    });

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
    assignedTo: v.optional(v.id('users')),
    isRedFlagged: v.optional(v.boolean()),
    status: v.optional(leadStatusValidator),
    customProperties: v.optional(v.record(v.string(), leadPropertyValueValidator)),
  },
  handler: async (ctx, args) => {
    // Marketing consent is deliberately not an accepted field — it is RGPD data
    // the lead controls, changeable only via the public consent link.
    const { leadId, email, customProperties, ...rest } = args;
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt != null) {
      throw new Error('lead_not_found');
    }

    const updates: Record<string, unknown> = { ...rest };
    if (email !== undefined) {
      updates['email'] = normalizeEmail(email);
    }
    if (customProperties !== undefined) {
      // Whole-record replace; computeChanges JSON-compares so the audit diff works.
      updates['customProperties'] = await sanitizeCustomProperties(ctx, customProperties);
    }

    const filtered = filterUndefined(updates);
    const changes = computeChanges(lead, filtered);
    await ctx.db.patch(leadId, { ...filtered, ...updateAuditFields(ctx.userId) });

    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'lead',
        entityId: leadId,
        action: 'update',
        metadata: { changes },
      });
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

/**
 * Bulk soft-delete leads from a selection. Missing or already-deleted ids are
 * skipped silently rather than aborting the batch; each successful delete is
 * audit-logged. Runs as a single transactional mutation.
 */
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

/**
 * Bulk upsert leads. The frontend parses the CSV and resolves columns before
 * calling, so each row is already typed. Rows carrying an email are matched by
 * normalized email: a new email is inserted; an existing one (deleted or not)
 * is updated in place, reviving it if soft-deleted. Rows without an email are
 * always inserted. Updates only overwrite columns the CSV actually provided
 * and union the array fields, so existing data is never dropped.
 */
export const importLeads = employeeMutation({
  args: {
    rows: v.array(
      v.object({
        ...leadRowArgs,
        customProperties: v.optional(v.record(v.string(), leadPropertyValueValidator)),
      })
    ),
    // Optional list every imported (created OR updated) lead is added to.
    listId: v.optional(v.id('leadLists')),
  },
  handler: async (ctx, args) => {
    const errors: { index: number; error: string }[] = [];
    let created = 0;
    let updated = 0;

    // Load the custom-property definitions once for the whole chunk.
    const propertyDefsById = await loadPropertyDefsById(ctx);
    // Active workflows, loaded once for every trigger dispatch in the loop.
    const activeWorkflows = await loadActiveWorkflows(ctx);

    for (let index = 0; index < args.rows.length; index++) {
      const row = args.rows[index];
      const email = normalizeEmail(row.email);

      let customProperties: Record<string, LeadPropertyValue> | undefined;
      try {
        customProperties = sanitizeCustomPropertiesWith(propertyDefsById, row.customProperties);
      } catch (e) {
        errors.push({ index, error: e instanceof Error ? e.message : 'invalid_property_value' });
        continue;
      }

      const existing = email
        ? await ctx.db
            .query('leads')
            .withIndex('by_email', (q) => q.eq('email', email))
            .first()
        : null;

      if (existing) {
        // Upsert: only patch columns the CSV provided (filterUndefined drops the
        // rest, keeping existing values) and never reset status/assignee.
        const updates: Record<string, unknown> = filterUndefined({
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          phone: row.phone?.trim() || undefined,
          address: row.address,
          comment: row.comment,
          assignedTo: row.assignedTo,
          isRedFlagged: row.isRedFlagged,
          status: row.status,
        });

        // Merge custom properties: provided keys overwrite, the rest are kept.
        if (customProperties && Object.keys(customProperties).length) {
          updates['customProperties'] = { ...existing.customProperties, ...customProperties };
        }

        const changes = computeChanges(existing, updates);
        const patchData: Record<string, unknown> = {
          ...updates,
          ...updateAuditFields(ctx.userId),
        };
        // Revive a soft-deleted lead (patching undefined removes the field).
        if (existing.deletedAt != null) patchData['deletedAt'] = undefined;
        await ctx.db.patch(existing._id, patchData);

        if (changes) {
          await logAudit({
            ctx,
            userId: ctx.userId,
            entityType: 'lead',
            entityId: existing._id,
            action: 'update',
            metadata: { changes },
          });
          const changedFields = diffLeadFilterFields(existing, updates);
          if (changedFields.length > 0) {
            await dispatchWorkflowTrigger(
              ctx,
              existing._id,
              { type: 'lead_property_changed', changedFields },
              { workflows: activeWorkflows }
            );
          }
        }
        if (args.listId) {
          await addLeadToList(ctx, args.listId, existing._id, ctx.userId, activeWorkflows);
        }
        updated++;
        continue;
      }

      const leadId = await ctx.db.insert('leads', {
        firstName: row.firstName.trim(),
        lastName: row.lastName.trim(),
        email,
        phone: row.phone?.trim() || undefined,
        address: row.address,
        // Consent starts empty; only the lead can grant it via the public link.
        marketingConsent: [],
        consentToken: generateHexToken(CONSENT_TOKEN_BYTES),
        comment: row.comment,
        assignedTo: row.assignedTo ?? ctx.userId,
        isRedFlagged: row.isRedFlagged ?? false,
        status: row.status ?? 'nouveau',
        customProperties,
        ...createAuditFields(ctx.userId),
      });
      await dispatchWorkflowTrigger(
        ctx,
        leadId,
        { type: 'lead_created' },
        { workflows: activeWorkflows }
      );
      if (args.listId) {
        await addLeadToList(ctx, args.listId, leadId, ctx.userId, activeWorkflows);
      }
      created++;
    }

    return { created, updated, errors };
  },
});

/**
 * Create an (empty) lead list, e.g. before a CSV import populates it. The
 * creator is stamped as the importer via createAuditFields.
 */
export const createLeadList = employeeMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error('Le nom de la liste est requis.');

    const listId = await ctx.db.insert('leadLists', {
      name,
      ...createAuditFields(ctx.userId),
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadList',
      entityId: listId,
      action: 'create',
    });

    return listId;
  },
});

// Members processed per deleteLeadList call. Each cascade-deleted lead writes up
// to 3 docs (lead patch + audit + membership delete), well under Convex's
// per-transaction write cap. The client loops until `done`.
const LIST_DELETE_BATCH = 200;

/**
 * Delete a lead list. Optionally soft-deletes its member leads (cascade).
 * Processes membership in bounded batches so very large lists don't exceed
 * Convex's per-transaction limits: returns `{ done: false }` while more members
 * remain, and the client calls again until `done` is true (at which point the
 * list document itself is removed).
 */
export const deleteLeadList = employeeMutation({
  args: { listId: v.id('leadLists'), deleteLeads: v.boolean() },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return { done: true as const, deletedLeads: 0 };

    const members = await ctx.db
      .query('leadListMembers')
      .withIndex('by_list_lead', (q) => q.eq('listId', args.listId))
      .take(LIST_DELETE_BATCH);

    let deletedLeads = 0;
    for (const member of members) {
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
      await ctx.db.delete(member._id);
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

/**
 * Add a free-text note to a lead. New notes are unpinned; the author is stamped
 * via createAuditFields (createdBy). Empty/whitespace content is rejected.
 */
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

/**
 * Build a recipient's merge `params` and its per-link tracked tokens (writing the
 * generated link URLs into `params`). Pure: the caller inserts the campaignSends
 * row and the campaignLinkTokens rows (which need the send id). Shared by
 * {@link createCampaign} and the resend mutations so a re-materialized send is
 * byte-for-byte the same shape as a freshly created one.
 */
function buildSendParams(
  lead: Doc<'leads'>,
  opts: {
    trackedLinks: CampaignTrackedLink[];
    defsById: Map<string, LeadPropertyDef>;
    consentBase: string;
    linkBase: string | undefined;
  }
): { params: Record<string, string>; tokens: { linkKey: string; token: string }[] } {
  const params = buildLeadParams(lead, opts.defsById, opts.consentBase);
  // One fresh token per (recipient × tracked link); the URL is injected into params.
  const tokens = opts.trackedLinks.map((link) => {
    const token = generateHexToken(TRACKED_LINK_TOKEN_BYTES);
    params[link.key] = `${opts.linkBase}/l/${token}`;
    return { linkKey: link.key, token };
  });
  return { params, tokens };
}

/**
 * Create a campaign from a resolved list of lead ids and kick off batched
 * sending. Each recipient gets a campaignSends row carrying its placeholder
 * params; recipients without an email are recorded as skipped.
 */
export const createCampaign = employeeMutation({
  args: {
    name: v.string(),
    channel: campaignChannelValidator,
    leadIds: v.array(v.id('leads')),
    // Email content — exactly one mode is provided by the caller:
    //  • template mode → brevoTemplateId
    //  • custom (WYSIWYG) mode → subject + htmlBody
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
    const uniqueIds = [...new Set(args.leadIds)];
    const consentBase = appOrigin() || 'http://localhost:4202';

    const name = args.name.trim();
    if (!name) throw new Error('Le nom de la campagne est requis.');

    const messageType = args.messageType ?? 'marketing';

    // Resolve the active email provider (snapshotted on the campaign) and Brevo
    // availability so we can reject channels/modes the provider can't serve.
    const cfg = await ctx.db.query('appConfig').first();
    const provider = resolveEmailProvider(cfg);
    const emailProvider = provider.kind;
    const smsAvailable = resolveBrevo(cfg).smsAvailable;

    // Custom-property definitions: substituted as {{ params.custom_<id> }} and
    // referenced by tracked links.
    const defsById = await loadPropertyDefsById(ctx);

    // Validate tracked links up front (keys, target field/property, value, redirect).
    const trackedLinks = args.trackedLinks ?? [];
    const linkKeys = new Set<string>();
    for (const link of trackedLinks) {
      if (!/^\w+$/.test(link.key) || RESERVED_PARAM_KEYS.has(link.key) || link.key.startsWith('custom_')) {
        throw new Error(`Clé de lien de suivi invalide : ${link.key}`);
      }
      if (linkKeys.has(link.key)) throw new Error(`Clé de lien de suivi en double : ${link.key}`);
      linkKeys.add(link.key);

      const valueError = validateLeadTargetValue(link.target, link.value, defsById);
      if (valueError) throw new Error(`Lien « ${link.label} » : ${valueError}`);

      if (link.redirectUrl !== undefined && !/^https?:\/\//.test(link.redirectUrl)) {
        throw new Error(`Lien « ${link.label} » : l'URL de redirection doit commencer par http(s)://`);
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
      // Email requires a usable delivery provider (Brevo key or SMTP host);
      // otherwise the campaign would silently never send.
      if (!isEmailProviderConfigured(provider)) {
        throw new Error(
          "Aucun fournisseur d'e-mail n'est configuré. Configurez Brevo ou SMTP dans Paramètres → E-mail."
        );
      }
      const customHtml = args.htmlBody?.trim();
      if (customHtml) {
        // Custom (WYSIWYG) email: a subject is required.
        subject = args.subject?.trim();
        if (!subject) throw new Error('L’objet de l’e-mail est requis.');
        htmlBody = customHtml;
      } else {
        // Template email: Brevo does the merge server-side, so it's unavailable
        // under SMTP.
        if (emailProvider === 'smtp') {
          throw new Error(
            'Les modèles Brevo ne sont pas disponibles en mode SMTP. Utilisez un e-mail personnalisé.'
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

    const campaignId = await ctx.db.insert('campaigns', {
      name,
      brevoTemplateId,
      subject,
      htmlBody,
      smsBody,
      messageType,
      channel: args.channel,
      // Snapshot the email provider so analytics degrade correctly even if the
      // admin later switches providers. Irrelevant for SMS campaigns.
      emailProvider: args.channel === 'email' ? emailProvider : undefined,
      trackedLinks: trackedLinks.length > 0 ? trackedLinks : undefined,
      status: 'sending',
      recipientLeadIds: uniqueIds,
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      ...createAuditFields(ctx.userId),
    });

    const isSms = args.channel === 'sms';
    let total = 0;
    let skipped = 0;
    let hasPending = false;

    // One campaignSends row per recipient. For SMS the contact field is `phone`
    // (recipients without one are skipped); for email it is `email`.
    for (const leadId of uniqueIds) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.deletedAt != null) continue;
      total++;

      // Rows are inserted only for sends that actually go out (skipped recipients
      // get dead URLs), but params/tokens are built the same way as on resend.
      const { params, tokens: leadTokens } = buildSendParams(lead, {
        trackedLinks,
        defsById,
        consentBase,
        linkBase,
      });

      const contact = isSms ? lead.phone : lead.email;
      if (!contact) {
        await ctx.db.insert('campaignSends', {
          campaignId,
          leadId,
          params,
          status: isSms ? 'skipped_no_phone' : 'skipped_no_email',
        });
        skipped++;
        continue;
      }

      const sendId = await ctx.db.insert('campaignSends', {
        campaignId,
        leadId,
        email: isSms ? undefined : lead.email,
        phone: isSms ? lead.phone : undefined,
        // Normalized recipient so an inbound STOP webhook can be matched by phone.
        smsRecipient: isSms ? (toBrevoRecipient(lead.phone) ?? undefined) : undefined,
        params,
        status: 'pending',
      });
      for (const { linkKey, token } of leadTokens) {
        await ctx.db.insert('campaignLinkTokens', { token, campaignId, sendId, leadId, linkKey });
      }
      hasPending = true;
    }

    await ctx.db.patch(campaignId, {
      totalCount: total,
      failedCount: skipped,
      status: hasPending ? 'sending' : 'sent',
    });

    if (hasPending) {
      await ctx.scheduler.runAfter(0, internal.features.crm.actions.sendCampaignBatch, {
        campaignId,
      });
    }

    return campaignId;
  },
});

/**
 * Throw (with the same French messages as createCampaign) when the campaign's
 * channel can't be delivered because its provider isn't configured — so a retry
 * never resets rows back into a silently-unconfigured provider.
 */
function assertChannelDeliverable(cfg: Doc<'appConfig'> | null, channel: 'email' | 'sms') {
  if (channel === 'sms') {
    if (!resolveBrevo(cfg).smsAvailable) {
      throw new Error('Les campagnes SMS nécessitent un compte Brevo configuré.');
    }
  } else if (!isEmailProviderConfigured(resolveEmailProvider(cfg))) {
    throw new Error(
      "Aucun fournisseur d'e-mail n'est configuré. Configurez Brevo ou SMTP dans Paramètres → E-mail."
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
    defsById: await loadPropertyDefsById(ctx),
    consentBase: appOrigin() || 'http://localhost:4202',
    linkBase,
  };
}

/**
 * Reset one send back to `pending` so the drain re-delivers it. `sent`/`failed`
 * rows already carry a contact + tracked-link tokens, so we reuse them; `skipped`
 * rows never did, so we re-resolve the lead's current contact and materialize
 * fresh params/tokens. Returns false when a skipped row's lead still has no
 * deliverable contact (nothing to send) so the caller can leave it skipped.
 */
async function requeueSend(
  ctx: MutationCtx,
  send: Doc<'campaignSends'>,
  remat: {
    isSms: boolean;
    trackedLinks: CampaignTrackedLink[];
    defsById: Map<string, LeadPropertyDef>;
    consentBase: string;
    linkBase: string | undefined;
  }
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
    const contact = lead && lead.deletedAt == null ? (remat.isSms ? lead.phone : lead.email) : undefined;
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

/**
 * Resend a single recipient, whatever its current status (delivered, failed, or
 * skipped). Resets the row to `pending`, adjusts the campaign counters, flips the
 * campaign back to `sending`, and reschedules the drain. `pending` rows are
 * already queued, so they are rejected.
 */
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
    assertChannelDeliverable(cfg, campaign.channel ?? 'email');

    const remat = await loadResendContext(ctx, campaign);
    if (!(await requeueSend(ctx, send, remat))) throw new Error('no_contact');

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

/**
 * Resend the whole campaign to every deliverable recipient (including those who
 * already received it). Re-queues each non-skipped row and re-materializes any
 * skipped row whose lead now has a contact; leaves the rest skipped. Counters are
 * reset — the drain re-tallies sent/failed via recordSendResults.
 */
export const resendAllCampaignSends = employeeMutation({
  args: { campaignId: v.id('campaigns') },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error('campaign_not_found');
    if (campaign.status === 'sending') throw new Error('campaign_sending');

    const cfg = await ctx.db.query('appConfig').first();
    assertChannelDeliverable(cfg, campaign.channel ?? 'email');

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

/**
 * PUBLIC (no auth): update a lead's marketing consent from its persistent
 * consent token, used by the unauthenticated RGPD consent page.
 */
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
      return { success: false as const, error: 'invalid_token' };
    }

    const channels = [...new Set(args.channels)];
    await ctx.db.patch(lead._id, {
      marketingConsent: channels,
      consentUpdatedAt: Date.now(),
      consentSource: 'public_link',
      updatedAt: Date.now(),
    });

    await dispatchWorkflowTrigger(ctx, lead._id, { type: 'consent_updated' });

    return { success: true as const };
  },
});
