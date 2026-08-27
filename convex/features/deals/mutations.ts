import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { adminMutation, employeeMutation } from '../../_lib/auth';
import { propertyValueValidator } from '../../_lib/validators/properties';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../lib/properties';
import {
  pipelineStageValidator,
  validatePipelineStages,
  type PipelineStage,
} from '../../_lib/validators/deals';
import {
  computeChanges,
  createAuditFields,
  filterUndefined,
  isNotDeleted,
  logAudit,
  updateAuditFields,
} from '../../lib';
import { stageTotals, statusTotals } from '../../lib/dealAggregates';
import {
  createDealRecord,
  ensureDefaultPipeline as ensureDefault,
  loadPipeline,
  moveDealToStage,
} from '../../lib/deals';

function normalizeStages(stages: PipelineStage[]): PipelineStage[] {
  const normalized = stages.map((s) => ({ key: s.key, label: s.label.trim(), kind: s.kind }));
  const error = validatePipelineStages(normalized);
  if (error) throw new Error(error);
  return normalized;
}

/** Idempotent: creates the stock pipeline when the instance has none. */
export const ensureDefaultPipeline = employeeMutation({
  args: {},
  handler: async (ctx) => await ensureDefault(ctx, ctx.userId),
});

export const createPipeline = adminMutation({
  args: {
    name: v.string(),
    stages: v.array(pipelineStageValidator),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error('pipeline_name_required');
    const stages = normalizeStages(args.stages);
    const others = (await ctx.db.query('pipelines').collect()).filter(isNotDeleted);
    const isDefault = args.isDefault || others.length === 0;
    if (isDefault) {
      for (const other of others) {
        if (other.isDefault) await ctx.db.patch(other._id, { isDefault: undefined });
      }
    }
    const pipelineId = await ctx.db.insert('pipelines', {
      name,
      stages,
      isDefault: isDefault || undefined,
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'pipeline',
      entityId: pipelineId,
      action: 'create',
    });
    return pipelineId;
  },
});

export const updatePipeline = adminMutation({
  args: {
    pipelineId: v.id('pipelines'),
    name: v.optional(v.string()),
    stages: v.optional(v.array(pipelineStageValidator)),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const pipeline = await loadPipeline(ctx, args.pipelineId);
    const updates: Partial<Doc<'pipelines'>> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error('pipeline_name_required');
      updates.name = name;
    }
    if (args.stages !== undefined) {
      const stages = normalizeStages(args.stages);
      const kept = new Set(stages.map((s) => s.key));
      for (const stage of pipeline.stages) {
        if (kept.has(stage.key)) continue;
        if ((await stageTotals(ctx, pipeline._id, stage.key)).count > 0) {
          throw new Error('pipeline_stage_in_use');
        }
      }
      updates.stages = stages;
    }
    if (args.isDefault) {
      const others = (await ctx.db.query('pipelines').collect()).filter(isNotDeleted);
      for (const other of others) {
        if (other._id !== pipeline._id && other.isDefault) {
          await ctx.db.patch(other._id, { isDefault: undefined });
        }
      }
      updates.isDefault = true;
    }
    const changes = computeChanges(pipeline, filterUndefined(updates));
    await ctx.db.patch(pipeline._id, { ...updates, ...updateAuditFields(ctx.userId) });
    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'pipeline',
        entityId: pipeline._id,
        action: 'update',
        metadata: { changes },
      });
    }
    return pipeline._id;
  },
});

/** Soft-delete an empty pipeline (no live deal in any status). */
export const deletePipeline = adminMutation({
  args: { pipelineId: v.id('pipelines') },
  handler: async (ctx, args) => {
    const pipeline = await loadPipeline(ctx, args.pipelineId);
    for (const status of ['open', 'won', 'lost'] as const) {
      if ((await statusTotals(ctx, pipeline._id, status)).count > 0) {
        throw new Error('pipeline_in_use');
      }
    }
    await ctx.db.patch(pipeline._id, {
      deletedAt: Date.now(),
      isDefault: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'pipeline',
      entityId: pipeline._id,
      action: 'delete',
    });
  },
});

const dealFieldArgs = {
  title: v.string(),
  amount: v.optional(v.number()),
  currency: v.optional(v.string()),
  expectedCloseDate: v.optional(v.string()),
  ownerId: v.optional(v.id('users')),
  leadId: v.optional(v.id('leads')),
  sourceCampaignId: v.optional(v.id('campaigns')),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/** Field-level checks shared by create and update; throws `invalid_deal: <field>`. */
async function validateDealFields(
  ctx: MutationCtx,
  fields: {
    title?: string;
    amount?: number;
    currency?: string;
    expectedCloseDate?: string;
    ownerId?: Id<'users'>;
    leadId?: Id<'leads'>;
    sourceCampaignId?: Id<'campaigns'>;
  },
): Promise<void> {
  if (fields.title !== undefined && !fields.title.trim()) throw new Error('deal_title_required');
  if (fields.amount !== undefined && (!Number.isFinite(fields.amount) || fields.amount < 0)) {
    throw new Error('invalid_deal: amount');
  }
  if (fields.currency !== undefined && !CURRENCY_RE.test(fields.currency.toUpperCase())) {
    throw new Error('invalid_deal: currency');
  }
  if (fields.expectedCloseDate !== undefined && !DATE_RE.test(fields.expectedCloseDate)) {
    throw new Error('invalid_deal: expectedCloseDate');
  }
  if (fields.ownerId && !(await ctx.db.get(fields.ownerId)))
    throw new Error('invalid_deal: ownerId');
  if (fields.leadId) {
    const lead = await ctx.db.get(fields.leadId);
    if (!lead || !isNotDeleted(lead)) throw new Error('lead_not_found');
  }
  if (fields.sourceCampaignId && !(await ctx.db.get(fields.sourceCampaignId))) {
    throw new Error('invalid_deal: sourceCampaignId');
  }
}

export const createDeal = employeeMutation({
  args: {
    ...dealFieldArgs,
    pipelineId: v.optional(v.id('pipelines')),
    stageKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await validateDealFields(ctx, args);
    return await createDealRecord(
      ctx,
      {
        ...args,
        ownerId: args.ownerId ?? ctx.userId,
        customProperties: sanitizeCustomProperties(
          await loadPropertyDefsById(ctx, 'deal'),
          args.customProperties,
        ),
      },
      { source: 'create', changedBy: ctx.userId },
    );
  },
});

/** Edit a deal's fields. The stage moves through `moveDealStage` only. */
export const updateDeal = employeeMutation({
  args: {
    dealId: v.id('deals'),
    ...dealFieldArgs,
    title: v.optional(v.string()),
    // null clears an optional relation / field.
    ownerId: v.optional(v.union(v.id('users'), v.null())),
    leadId: v.optional(v.union(v.id('leads'), v.null())),
    sourceCampaignId: v.optional(v.union(v.id('campaigns'), v.null())),
    expectedCloseDate: v.optional(v.union(v.string(), v.null())),
    amount: v.optional(v.union(v.number(), v.null())),
    lossReason: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { dealId, customProperties, ...rest } = args;
    const deal = await ctx.db.get(dealId);
    if (!deal || !isNotDeleted(deal)) throw new Error('deal_not_found');
    const nonNull = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== null),
    ) as Parameters<typeof validateDealFields>[1];
    await validateDealFields(ctx, nonNull);

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      // null → remove the field; `filterUndefined` keeps null so patch clears it.
      updates[key] = value === null ? undefined : value;
    }
    if (typeof updates.title === 'string') updates.title = updates.title.trim();
    if (typeof updates.currency === 'string') updates.currency = updates.currency.toUpperCase();
    if (typeof updates.lossReason === 'string')
      updates.lossReason = updates.lossReason.trim() || undefined;
    if (customProperties !== undefined) {
      updates.customProperties = sanitizeCustomProperties(
        await loadPropertyDefsById(ctx, 'deal'),
        customProperties,
      );
    }

    const changes = computeChanges(deal, filterUndefined(updates));
    await ctx.db.patch(dealId, { ...updates, ...updateAuditFields(ctx.userId) });
    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'deal',
        entityId: dealId,
        action: 'update',
        metadata: { changes },
      });
    }
    return dealId;
  },
});

/** Move a deal to a stage of its pipeline (Kanban drop, stage stepper, won/lost buttons). */
export const moveDealStage = employeeMutation({
  args: { dealId: v.id('deals'), stageKey: v.string(), lossReason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const deal = await ctx.db.get(args.dealId);
    if (!deal || !isNotDeleted(deal)) throw new Error('deal_not_found');
    const move = await moveDealToStage(
      ctx,
      deal,
      args.stageKey,
      { source: 'manual', changedBy: ctx.userId },
      { lossReason: args.lossReason },
    );
    if (move.kind === 'unknown_stage') throw new Error('unknown_stage');
    return move.kind;
  },
});

export const deleteDeal = employeeMutation({
  args: { dealId: v.id('deals') },
  handler: async (ctx, args) => {
    const deal = await ctx.db.get(args.dealId);
    if (!deal || !isNotDeleted(deal)) throw new Error('deal_not_found');
    await ctx.db.patch(args.dealId, { deletedAt: Date.now(), ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'deal',
      entityId: args.dealId,
      action: 'delete',
    });
  },
});
