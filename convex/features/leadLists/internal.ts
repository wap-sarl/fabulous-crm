import { v } from 'convex/values';
import { internalMutation } from '../../_lib/functions';
import { loadActiveWorkflows } from '../../lib/workflows/dispatch';
import { evalAdvancedFilter } from '../../lib/leads/matching';
import { criteriaUsesRelativeDates } from '../../_lib/validators/leadLists';
import { startDynamicListRecalc, syncDynamicMembership } from '../../lib/leadLists/dynamic';
import { isNotDeleted } from '../../_lib/softDelete';
import { internal } from '../../_generated/api';
import { DAY_MS } from '../../_lib/time';

const RECALC_BATCH = 100;
const DRIFT_RECALC_MS = DAY_MS;

export const recalcDynamicListPage = internalMutation({
  args: { listId: v.id('leadLists'), stamp: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (list?.kind !== 'dynamic' || !list.criteria) return;
    if (list.recalc?.stamp !== args.stamp) return;

    const page = await ctx.db
      .query('leads')
      .paginate({ cursor: args.cursor ?? null, numItems: RECALC_BATCH });
    const workflows = await loadActiveWorkflows(ctx);
    for (const lead of page.page) {
      const should = isNotDeleted(lead) && evalAdvancedFilter(lead, list.criteria);
      await syncDynamicMembership(ctx, args.listId, lead._id, should, workflows);
    }

    if (!page.isDone) {
      await ctx.db.patch(args.listId, {
        recalc: { stamp: args.stamp, processed: list.recalc.processed + page.page.length },
      });
      await ctx.scheduler.runAfter(0, internal.features.leadLists.internal.recalcDynamicListPage, {
        listId: args.listId,
        stamp: args.stamp,
        cursor: page.continueCursor,
      });
      return;
    }

    const nextRecalcId = criteriaUsesRelativeDates(list.criteria)
      ? await ctx.scheduler.runAfter(
          DRIFT_RECALC_MS,
          internal.features.leadLists.internal.startScheduledListRecalc,
          { listId: args.listId },
        )
      : undefined;
    await ctx.db.patch(args.listId, {
      recalc: undefined,
      lastRecalcAt: Date.now(),
      nextRecalcId,
    });
  },
});

/** Time-drift reconciliation entry point (booked by recalcDynamicListPage). */
export const startScheduledListRecalc = internalMutation({
  args: { listId: v.id('leadLists') },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (list && list.kind === 'dynamic') await startDynamicListRecalc(ctx, list);
  },
});
