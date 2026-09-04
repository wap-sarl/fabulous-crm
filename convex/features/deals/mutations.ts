import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { settingsMutation, employeeMutation } from '../../_lib/auth';
import { propertyValueValidator } from '../../_lib/validators/properties';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../lib/properties';
import {
  normalizeTransitions,
  pipelineLayoutValidator,
  pipelineStageValidator,
  pipelineTransitionValidator,
  pruneLayout,
  pruneTransitions,
  validatePipelineStages,
  validatePipelineTransitions,
  type PipelineStage,
  type PipelineTransition,
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
  validateDealFields,
} from '../../lib/deals';

function normalizeStages(stages: PipelineStage[]): PipelineStage[] {
  const normalized = stages.map((s) => ({
    key: s.key,
    label: s.label.trim(),
    kind: s.kind,
    tags: s.tags?.length ? s.tags.map((t) => ({ key: t.key, label: t.label.trim() })) : undefined,
    tagsRequired: s.tags?.length && s.tagsRequired ? true : undefined,
  }));
  const error = validatePipelineStages(normalized);
  if (error) throw new Error(error);
  return normalized;
}

/** Structural check of a graph against its stages; returns the value to store. */
function checkTransitions(
  stages: PipelineStage[],
  transitions: PipelineTransition[] | undefined,
): PipelineTransition[] | undefined {
  const error = validatePipelineTransitions(stages, transitions);
  if (error) throw new Error(error);
  return normalizeTransitions(stages, transitions);
}

/** Idempotent: creates the stock pipeline when the instance has none. */
export const ensureDefaultPipeline = employeeMutation({
  args: {},
  handler: async (ctx) => await ensureDefault(ctx, ctx.userId),
});

export const createPipeline = settingsMutation({
  args: {
    name: v.string(),
    stages: v.array(pipelineStageValidator),
    transitions: v.optional(v.array(pipelineTransitionValidator)),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error('pipeline_name_required');
    const stages = normalizeStages(args.stages);
    const transitions = checkTransitions(stages, args.transitions);
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
      transitions,
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

export const updatePipeline = settingsMutation({
  args: {
    pipelineId: v.id('pipelines'),
    name: v.optional(v.string()),
    stages: v.optional(v.array(pipelineStageValidator)),
    // null clears the graph (everything allowed again).
    transitions: v.optional(v.union(v.array(pipelineTransitionValidator), v.null())),
    layout: v.optional(v.union(pipelineLayoutValidator, v.null())),
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
    // The graph is validated against the stages being saved; keys survive a
    // rename or reorder, and a removed stage takes its arrows along.
    const stages = updates.stages ?? pipeline.stages;
    if (args.transitions !== undefined) {
      updates.transitions = checkTransitions(stages, args.transitions ?? undefined);
    } else if (updates.stages) {
      updates.transitions = checkTransitions(
        stages,
        pruneTransitions(pipeline.transitions, stages),
      );
    }
    if (args.layout !== undefined) {
      updates.layout = pruneLayout(args.layout ?? undefined, stages);
    } else if (updates.stages) {
      updates.layout = pruneLayout(pipeline.layout, stages);
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
    // `computeChanges` ignores undefined values, so a cleared graph (stored as
    // an absent field — patching `undefined` removes it) is tracked here.
    const graphChanged =
      ('transitions' in updates &&
        JSON.stringify(updates.transitions ?? null) !==
          JSON.stringify(pipeline.transitions ?? null)) ||
      ('layout' in updates &&
        JSON.stringify(updates.layout ?? null) !== JSON.stringify(pipeline.layout ?? null));
    await ctx.db.patch(pipeline._id, { ...updates, ...updateAuditFields(ctx.userId) });
    if (changes || graphChanged) {
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
export const deletePipeline = settingsMutation({
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
  ownerIds: v.optional(v.array(v.id('users'))),
  leadId: v.optional(v.id('leads')),
  sourceCampaignId: v.optional(v.id('campaigns')),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
} as const;

export const createDeal = employeeMutation({
  args: {
    ...dealFieldArgs,
    pipelineId: v.optional(v.id('pipelines')),
    stageKey: v.optional(v.string()),
    stageTags: v.optional(v.array(v.string())),
    stageComment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await validateDealFields(ctx, args);
    return await createDealRecord(
      ctx,
      {
        ...args,
        ownerIds: args.ownerIds?.length ? args.ownerIds : [ctx.userId],
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
    leadId: v.optional(v.union(v.id('leads'), v.null())),
    sourceCampaignId: v.optional(v.union(v.id('campaigns'), v.null())),
    expectedCloseDate: v.optional(v.union(v.string(), v.null())),
    amount: v.optional(v.union(v.number(), v.null())),
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
  args: {
    dealId: v.id('deals'),
    stageKey: v.string(),
    tags: v.optional(v.array(v.string())),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deal = await ctx.db.get(args.dealId);
    if (!deal || !isNotDeleted(deal)) throw new Error('deal_not_found');
    const move = await moveDealToStage(
      ctx,
      deal,
      args.stageKey,
      { source: 'manual', changedBy: ctx.userId },
      { tags: args.tags, comment: args.comment },
    );
    if (move.kind === 'unknown_stage') throw new Error('unknown_stage');
    if (move.kind === 'unknown_tag') throw new Error('unknown_stage_tag');
    if (move.kind === 'tag_required') throw new Error('stage_tag_required');
    if (move.kind === 'forbidden') throw new Error('deal_transition_forbidden');
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
