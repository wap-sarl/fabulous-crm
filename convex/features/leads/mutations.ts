import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { employeeMutation } from '../../_lib/auth';
import {
  createAuditFields,
  updateAuditFields,
  computeChanges,
  logAudit,
} from '../../lib/audit/log';
import { filterUndefined, isNotDeleted } from '../../lib/shared/db';
import { generateHexToken } from '../../lib/security/crypto';
import { editNote, liveNote } from '../../lib/leads/notes';
import { stampLeadSignal } from '../../lib/leads/signals';
import { addressValidator, propertyValueValidator } from '../../schema';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../lib/properties/definitions';
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
import { dispatchWorkflowTrigger } from '../../lib/workflows/dispatch';
import { diffLeadFilterFields } from '../../lib/workflows/rules';
import { gateLeadCreate } from '../../lib/extensions/gates';
import {
  applyLeadImport,
  loadLeadImportCaches,
  normalizeEmail,
  planLeadImport,
} from '../../lib/leads/import';
import { companyHintValidator, leadImportRowValidator } from '../../_lib/validators/imports';
import { CONSENT_TOKEN_BYTES } from '../../lib/leads/import';

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
  company: v.optional(companyHintValidator),
} as const;

function initialLifecycleStage(config: LifecycleConfig, requested: string | undefined): string {
  if (requested === undefined) return config.defaultStage;
  if (lifecycleStageIndex(config, requested) === -1) throw refusal('unknown_lifecycle_stage');
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
      throw refusal('lead_not_found');
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

/** Marks a live contact deleted and audits it; false for one that is missing or already deleted. */
async function softDeleteLead(
  ctx: MutationCtx,
  userId: Id<'users'>,
  leadId: Id<'leads'>,
): Promise<boolean> {
  const lead = await ctx.db.get(leadId);
  if (!lead || lead.deletedAt != null) return false;
  await ctx.db.patch(leadId, {
    deletedAt: Date.now(),
    ...updateAuditFields(userId),
  });
  await logAudit({
    ctx,
    userId,
    entityType: 'lead',
    entityId: leadId,
    action: 'delete',
  });
  return true;
}

export const deleteLead = employeeMutation({
  args: { leadId: v.id('leads') },
  handler: async (ctx, args) => {
    if (!(await softDeleteLead(ctx, ctx.userId, args.leadId))) throw refusal('lead_not_found');
  },
});

/** Missing or already deleted ids are skipped silently rather than aborting the batch. */
export const deleteLeads = employeeMutation({
  args: { leadIds: v.array(v.id('leads')) },
  handler: async (ctx, args) => {
    const uniqueIds = [...new Set(args.leadIds)];
    let deleted = 0;
    for (const leadId of uniqueIds) {
      if (await softDeleteLead(ctx, ctx.userId, leadId)) deleted++;
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
      if (!list) throw refusal('list_not_found');
      if (list.kind === 'dynamic') throw refusal('list_is_dynamic');
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

export const createNote = employeeMutation({
  args: {
    leadId: v.id('leads'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) {
      throw refusal('lead_not_found');
    }
    const content = args.content.trim();
    if (!content) {
      throw refusal('empty_note');
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
    const note = await liveNote(ctx, args.noteId);
    const content = args.content.trim();
    if (!content) {
      throw refusal('empty_note');
    }
    return await editNote(ctx, ctx.userId, note, { content });
  },
});

/** Pin or unpin a note (idempotent — explicit boolean rather than a toggle). */
export const setNotePinned = employeeMutation({
  args: {
    noteId: v.id('leadNotes'),
    isPinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const note = await liveNote(ctx, args.noteId);
    return await editNote(ctx, ctx.userId, note, { isPinned: args.isPinned });
  },
});

/** Soft-delete a note. */
export const deleteNote = employeeMutation({
  args: { noteId: v.id('leadNotes') },
  handler: async (ctx, args) => {
    await liveNote(ctx, args.noteId);
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
