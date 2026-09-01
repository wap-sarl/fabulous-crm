import { employeeQuery } from '../../_lib/auth';

/** Every rule in display order, for the settings page and breakdown cards. */
export const listScoringRules = employeeQuery({
  args: {},
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
