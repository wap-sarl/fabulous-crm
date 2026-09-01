import { v } from 'convex/values';
import { settingsMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import {
  leadAdvancedFilterValidator,
  type LeadAdvancedFilter,
} from '../../_lib/validators/filters';
import {
  MAX_DECAY_HALF_LIFE_DAYS,
  MAX_LEAD_SCORE,
  MIN_LEAD_SCORE,
  validateScoringCriteria,
} from '../../_lib/validators/scoring';
import { createAuditFields, logAudit, updateAuditFields } from '../../lib';
import { ensureScoringState, loadScoringRules, startScoreRecompute } from '../../lib/leadScoring';

function checkPoints(points: number): void {
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > MAX_LEAD_SCORE) {
    throw new Error('invalid_scoring_points');
  }
}

function checkDecay(days: number | undefined): void {
  if (days === undefined) return;
  if (!Number.isFinite(days) || days <= 0 || days > MAX_DECAY_HALF_LIFE_DAYS) {
    throw new Error('invalid_scoring_decay');
  }
}

function checkCriteria(criteria: LeadAdvancedFilter): void {
  const error = validateScoringCriteria(criteria);
  if (error) throw new Error(error);
}

export const createScoringRule = settingsMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    criteria: leadAdvancedFilterValidator,
    points: v.number(),
    active: v.boolean(),
    decayHalfLifeDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error('scoring_name_required');
    checkPoints(args.points);
    checkDecay(args.decayHalfLifeDays);
    checkCriteria(args.criteria);

    const rules = await loadScoringRules(ctx);
    const ruleId = await ctx.db.insert('scoringRules', {
      name,
      description: args.description?.trim() || undefined,
      criteria: args.criteria,
      points: args.points,
      active: args.active,
      decayHalfLifeDays: args.decayHalfLifeDays,
      order: (rules[rules.length - 1]?.order ?? -1) + 1,
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'scoringRule',
      entityId: ruleId,
      action: 'create',
      metadata: { points: args.points, active: args.active },
    });
    await startScoreRecompute(ctx);
    return ruleId;
  },
});

export const updateScoringRule = settingsMutation({
  args: {
    ruleId: v.id('scoringRules'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    criteria: v.optional(leadAdvancedFilterValidator),
    points: v.optional(v.number()),
    active: v.optional(v.boolean()),
    // null clears the decay (undefined = untouched).
    decayHalfLifeDays: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) throw new Error('scoring_rule_not_found');

    const patch: Partial<typeof rule> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error('scoring_name_required');
      patch.name = name;
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.points !== undefined) {
      checkPoints(args.points);
      patch.points = args.points;
    }
    if (args.active !== undefined) patch.active = args.active;
    if (args.criteria !== undefined) {
      checkCriteria(args.criteria);
      patch.criteria = args.criteria;
    }
    if (args.decayHalfLifeDays !== undefined) {
      const days = args.decayHalfLifeDays ?? undefined;
      checkDecay(days);
      patch.decayHalfLifeDays = days;
    }

    await ctx.db.patch(args.ruleId, { ...patch, ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'scoringRule',
      entityId: args.ruleId,
      action: 'update',
      metadata: { fields: Object.keys(patch) },
    });

    // Cosmetic edits (name, description) leave every stored score valid.
    const affectsScores = ['criteria', 'points', 'active', 'decayHalfLifeDays'].some(
      (f) => f in patch,
    );
    if (affectsScores) await startScoreRecompute(ctx);
  },
});

export const deleteScoringRule = settingsMutation({
  args: { ruleId: v.id('scoringRules') },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) return;
    await ctx.db.delete(args.ruleId);
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'scoringRule',
      entityId: args.ruleId,
      action: 'delete',
    });
    // The recomputation also scrubs the rule from every stored breakdown.
    await startScoreRecompute(ctx);
  },
});

export const reorderScoringRules = settingsMutation({
  args: { ruleIds: v.array(v.id('scoringRules')) },
  handler: async (ctx, args) => {
    const rules = await loadScoringRules(ctx);
    const known = new Set(rules.map((r) => r._id));
    const seen = new Set<Id<'scoringRules'>>();
    for (const id of args.ruleIds) {
      if (!known.has(id) || seen.has(id)) throw new Error('invalid_scoring_order');
      seen.add(id);
    }
    if (seen.size !== known.size) throw new Error('invalid_scoring_order');
    for (const [index, id] of args.ruleIds.entries()) {
      await ctx.db.patch(id, { order: index });
    }
  },
});

/** Manual full recomputation (settings page button). */
export const recomputeScores = settingsMutation({
  args: {},
  handler: async (ctx) => {
    await startScoreRecompute(ctx);
  },
});

/**
 * Count how many leads would sit at or above `threshold` with the current
 * rules, in batched jobs (never a full scan in a query). Progress and result
 * land on the scoringState singleton.
 */
export const startScoreSimulation = settingsMutation({
  args: { threshold: v.number() },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.threshold) ||
      args.threshold < MIN_LEAD_SCORE ||
      args.threshold > MAX_LEAD_SCORE
    ) {
      throw new Error('invalid_scoring_threshold');
    }
    const state = await ensureScoringState(ctx);
    const stamp = Date.now();
    await ctx.db.patch(state._id, {
      simulation: { threshold: args.threshold, stamp, processed: 0, matched: 0 },
    });
    await ctx.scheduler.runAfter(0, internal.features.scoring.internal.simulateScoresPage, {
      stamp,
    });
  },
});
