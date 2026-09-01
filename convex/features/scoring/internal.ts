import { v } from 'convex/values';
// Trigger-wrapped constructor: score patches must run the lead triggers (functions.ts).
import { internalMutation } from '../../_lib/functions';
import { internal } from '../../_generated/api';
import { scoringNeedsNightlyRecompute } from '../../_lib/validators/scoring';
import { isNotDeleted } from '../../_lib/softDelete';
import { loadLifecycleConfig } from '../../lib/lifecycle';
import { DAY_MS } from '../../lib/timeConstants';
import {
  applyLeadScore,
  computeLeadScore,
  ensureScoringState,
  loadScoringRules,
  startScoreRecompute,
} from '../../lib/leadScoring';
import { loadActiveWorkflows } from '../workflows/triggerDispatch';

const RECOMPUTE_BATCH = 100;

export const recomputeScoresPage = internalMutation({
  args: { stamp: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('scoringState').first();
    if (state?.recalc?.stamp !== args.stamp) return;

    const rules = await loadScoringRules(ctx);
    const lifecycle = await loadLifecycleConfig(ctx);
    const workflows = await loadActiveWorkflows(ctx);
    const page = await ctx.db
      .query('leads')
      .paginate({ cursor: args.cursor ?? null, numItems: RECOMPUTE_BATCH });
    for (const lead of page.page) {
      if (!isNotDeleted(lead)) continue;
      await applyLeadScore(ctx, lead, rules, { lifecycle, workflows });
    }

    if (!page.isDone) {
      await ctx.db.patch(state._id, {
        recalc: { stamp: args.stamp, processed: state.recalc.processed + page.page.length },
      });
      await ctx.scheduler.runAfter(0, internal.features.scoring.internal.recomputeScoresPage, {
        stamp: args.stamp,
        cursor: page.continueCursor,
      });
      return;
    }

    // Decayed points and relative-date criteria drift with time: recompute nightly.
    const nextRecalcId = scoringNeedsNightlyRecompute(rules)
      ? await ctx.scheduler.runAfter(
          DAY_MS,
          internal.features.scoring.internal.startScheduledScoreRecompute,
          {},
        )
      : undefined;
    await ctx.db.patch(state._id, {
      recalc: undefined,
      lastRecalcAt: Date.now(),
      nextRecalcId,
    });
  },
});

/** Nightly time-drift entry point (booked by recomputeScoresPage). */
export const startScheduledScoreRecompute = internalMutation({
  args: {},
  handler: async (ctx) => {
    await startScoreRecompute(ctx);
  },
});

export const simulateScoresPage = internalMutation({
  args: { stamp: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const state = await ensureScoringState(ctx);
    const sim = state.simulation;
    if (sim?.stamp !== args.stamp || sim.finishedAt !== undefined) return;

    const rules = await loadScoringRules(ctx);
    const now = Date.now();
    const page = await ctx.db
      .query('leads')
      .paginate({ cursor: args.cursor ?? null, numItems: RECOMPUTE_BATCH });
    let matched = 0;
    let processed = 0;
    for (const lead of page.page) {
      if (!isNotDeleted(lead)) continue;
      processed++;
      // Prospective score, computed on the fly — immune to a recompute racing us.
      if (computeLeadScore(lead, rules, now).score >= sim.threshold) matched++;
    }

    await ctx.db.patch(state._id, {
      simulation: {
        ...sim,
        processed: sim.processed + processed,
        matched: sim.matched + matched,
        finishedAt: page.isDone ? Date.now() : undefined,
      },
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.features.scoring.internal.simulateScoresPage, {
        stamp: args.stamp,
        cursor: page.continueCursor,
      });
    }
  },
});
