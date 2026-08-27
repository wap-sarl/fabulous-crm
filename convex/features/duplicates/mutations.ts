import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { employeeMutation, settingsMutation } from '../../_lib/auth';
import { propertyValueValidator } from '../../_lib/validators/properties';
import { addressValidator } from '../../schema';
import {
  computeChanges,
  filterUndefined,
  insertLifecycleHistory,
  isNotDeleted,
  loadLifecycleConfig,
  logAudit,
  planLifecycleTransition,
  updateAuditFields,
} from '../../lib';
import { requireValidAddress } from '../../lib/addresses';
import { requireCompany } from '../../lib/companies';
import { repointLeadRows } from '../../lib/duplicates';
import { cleanOwnerIds } from '../../lib/owners';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../lib/properties';
import { diffLeadFilterFields } from '../workflows/lib';
import { dispatchWorkflowTrigger, loadActiveWorkflows } from '../workflows/triggerDispatch';

/** A scan left `running` past this is assumed dead (deployment restart) and can be replaced. */
const STALE_SCAN_MS = 15 * 60 * 1000;

/** Start a batched scan of the whole leads table. One at a time. */
export const startDuplicateScan = settingsMutation({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db
      .query('duplicateScans')
      .withIndex('by_status', (q) => q.eq('status', 'running'))
      .first();
    if (running) {
      if (Date.now() - running.startedAt < STALE_SCAN_MS) throw new Error('scan_running');
      await ctx.db.patch(running._id, { status: 'done', finishedAt: Date.now() });
    }
    const scanId = await ctx.db.insert('duplicateScans', {
      status: 'running',
      scanned: 0,
      found: 0,
      startedBy: ctx.userId,
      startedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.features.duplicates.internal.scanDuplicatesBatch, {
      scanId,
    });
    return scanId;
  },
});

/** Mark a pair as not duplicates; later scans leave it alone. */
export const ignoreDuplicatePair = employeeMutation({
  args: { pairId: v.id('leadDuplicates') },
  handler: async (ctx, args) => {
    const pair = await ctx.db.get(args.pairId);
    if (!pair) throw new Error('pair_not_found');
    await ctx.db.patch(args.pairId, { status: 'ignored', updatedAt: Date.now() });
  },
});

/** Delete every pair row involving a lead (after a merge or a delete). */
async function deletePairsOf(ctx: MutationCtx, leadId: Id<'leads'>) {
  for (const index of ['by_leadA', 'by_leadB'] as const) {
    const field = index === 'by_leadA' ? 'leadAId' : 'leadBId';
    const rows = await ctx.db
      .query('leadDuplicates')
      .withIndex(index, (q) => q.eq(field, leadId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  }
}

/** The survivor fields a merge may overwrite; `null` clears an optional one. */
const mergeFieldArgs = {
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  email: v.optional(v.union(v.string(), v.null())),
  phone: v.optional(v.union(v.string(), v.null())),
  address: v.optional(v.union(addressValidator, v.null())),
  comment: v.optional(v.union(v.string(), v.null())),
  ownerIds: v.optional(v.array(v.id('users'))),
  companyId: v.optional(v.union(v.id('companies'), v.null())),
  lifecycleStage: v.optional(v.string()),
  isRedFlagged: v.optional(v.boolean()),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
} as const;

export const mergeLeads = employeeMutation({
  args: {
    survivorId: v.id('leads'),
    absorbedId: v.id('leads'),
    fields: v.object(mergeFieldArgs),
  },
  handler: async (ctx, args) => {
    if (args.survivorId === args.absorbedId) throw new Error('merge_same_lead');
    const survivor = await ctx.db.get(args.survivorId);
    const absorbed = await ctx.db.get(args.absorbedId);
    if (!survivor || !isNotDeleted(survivor)) throw new Error('lead_not_found');
    if (!absorbed || !isNotDeleted(absorbed)) throw new Error('lead_not_found');

    const { fields } = args;
    const updates: Record<string, unknown> = {};
    if (fields.firstName !== undefined) {
      if (!fields.firstName.trim()) throw new Error('first_name_required');
      updates.firstName = fields.firstName.trim();
    }
    if (fields.lastName !== undefined) {
      if (!fields.lastName.trim()) throw new Error('last_name_required');
      updates.lastName = fields.lastName.trim();
    }
    if (fields.email !== undefined) updates.email = fields.email?.trim().toLowerCase() || undefined;
    if (fields.phone !== undefined) updates.phone = fields.phone?.trim() || undefined;
    if (fields.address !== undefined) {
      updates.address = fields.address ? requireValidAddress(fields.address) : undefined;
    }
    if (fields.comment !== undefined) updates.comment = fields.comment?.trim() || undefined;
    if (fields.ownerIds !== undefined) updates.ownerIds = await cleanOwnerIds(ctx, fields.ownerIds);
    if (fields.companyId !== undefined) {
      if (fields.companyId) await requireCompany(ctx, fields.companyId);
      updates.companyId = fields.companyId ?? undefined;
    }
    if (fields.isRedFlagged !== undefined) updates.isRedFlagged = fields.isRedFlagged;
    if (fields.customProperties !== undefined) {
      updates.customProperties = sanitizeCustomProperties(
        await loadPropertyDefsById(ctx, 'lead'),
        fields.customProperties,
      );
    }
    let lifecycleChange: { from: string | undefined; to: string } | undefined;
    if (fields.lifecycleStage !== undefined) {
      const plan = planLifecycleTransition(
        await loadLifecycleConfig(ctx),
        survivor,
        fields.lifecycleStage,
      );
      if (plan.kind === 'unknown_stage') throw new Error('unknown_lifecycle_stage');
      // A merge is a data repair, not a funnel move: regressions are allowed.
      if (plan.kind === 'change' || plan.kind === 'regression_blocked') {
        lifecycleChange = { from: survivor.lifecycleStage, to: fields.lifecycleStage };
        updates.lifecycleStage = fields.lifecycleStage;
      }
    }

    // Consent: union of both grants, stamped with the most recent decision.
    const consent = [...new Set([...survivor.marketingConsent, ...absorbed.marketingConsent])];
    if (consent.length !== survivor.marketingConsent.length) {
      updates.marketingConsent = consent;
      if ((absorbed.consentUpdatedAt ?? 0) > (survivor.consentUpdatedAt ?? 0)) {
        updates.consentUpdatedAt = absorbed.consentUpdatedAt;
        updates.consentSource = absorbed.consentSource;
      }
    }

    const changes = computeChanges(survivor, filterUndefined(updates));
    await ctx.db.patch(survivor._id, { ...updates, ...updateAuditFields(ctx.userId) });
    if (lifecycleChange) {
      await insertLifecycleHistory(ctx, survivor._id, lifecycleChange, {
        source: 'manual',
        changedBy: ctx.userId,
      });
    }

    const { moreLeft } = await repointLeadRows(ctx, absorbed._id, survivor._id);
    if (moreLeft) {
      await ctx.scheduler.runAfter(0, internal.features.duplicates.internal.repointMergedLead, {
        absorbedId: absorbed._id,
        survivorId: survivor._id,
      });
    }
    await deletePairsOf(ctx, absorbed._id);

    await ctx.db.patch(absorbed._id, { deletedAt: Date.now(), ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'lead',
      entityId: absorbed._id,
      action: 'delete',
      metadata: { mergedInto: survivor._id },
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'lead',
      entityId: survivor._id,
      action: 'merge',
      metadata: {
        absorbedLeadId: absorbed._id,
        absorbedLeadName: `${absorbed.firstName} ${absorbed.lastName}`,
        changes,
      },
    });

    if (changes) {
      const changedFields = diffLeadFilterFields(survivor, updates);
      if (changedFields.length > 0) {
        await dispatchWorkflowTrigger(
          ctx,
          survivor._id,
          { type: 'lead_property_changed', changedFields },
          { workflows: await loadActiveWorkflows(ctx) },
        );
      }
    }
    return { survivorId: survivor._id, repointingScheduled: moreLeft };
  },
});
