import { v } from 'convex/values';
import { leadAdvancedFilterValidator } from '../../_lib/validators/filters';
import { employeeQuery } from '../../_lib/auth';

/** Every rule in display order, for the settings page and breakdown cards. */
export const listScoringRules = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('scoringRules'),
      name: v.string(),
      description: v.optional(v.string()),
      criteria: leadAdvancedFilterValidator,
      points: v.number(),
      active: v.boolean(),
      decayHalfLifeDays: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const rules = await ctx.db.query('scoringRules').collect();
    return rules
      .sort((a, b) => a.order - b.order)
      .map((r) => ({
        _id: r._id,
        name: r.name,
        description: r.description,
        criteria: r.criteria,
        points: r.points,
        active: r.active,
        decayHalfLifeDays: r.decayHalfLifeDays,
      }));
  },
});

/** Recompute/simulation progress for the settings page. */
export const getScoringState = employeeQuery({
  args: {},
  returns: v.object({
    recalcProcessed: v.union(v.number(), v.null()),
    lastRecalcAt: v.union(v.number(), v.null()),
    nightlyScheduled: v.boolean(),
    simulation: v.union(
      v.object({
        finishedAt: v.optional(v.number()),
        stamp: v.number(),
        processed: v.number(),
        threshold: v.number(),
        matched: v.number(),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx) => {
    const state = await ctx.db.query('scoringState').first();
    return {
      recalcProcessed: state?.recalc?.processed ?? null,
      lastRecalcAt: state?.lastRecalcAt ?? null,
      nightlyScheduled: state?.nextRecalcId !== undefined,
      simulation: state?.simulation ?? null,
    };
  },
});
