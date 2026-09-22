import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalMutation } from '../../_lib/functions';
import { retentionPolicyOf, retentionPolicyValidator } from '../../_lib/validators/retention';
import { logAudit } from '../../lib';
import { loadDynamicLists, startDynamicListRecalc } from '../../lib/dynamicLists';
import { deferUnlessAllowed } from '../../lib/gates';
import {
  addCounts,
  emptyCounts,
  PURGE_MAX_PAGES,
  purgeCountsValidator,
  purgePage,
} from '../../lib/retention';

/**
 * The nightly purge (crons.ts): page after page until every table is under its retention, then one audit row
 * with the counts. The policy and the reference time are frozen on the first page and carried to the others:
 * a setting changed during a run does not mix cutoffs, and the report says which policy was applied.
 */
export const runPurge = internalMutation({
  args: {
    startedAt: v.optional(v.number()),
    page: v.optional(v.number()),
    counts: v.optional(purgeCountsValidator),
    policy: v.optional(retentionPolicyValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // A suspended or maintained deployment deletes nothing; the run comes back later, frozen policy included.
    if (
      await deferUnlessAllowed(
        ctx,
        'retention_purge',
        internal.features.retention.internal.runPurge,
        args,
      )
    ) {
      return null;
    }
    const startedAt = args.startedAt ?? Date.now();
    const page = args.page ?? 1;
    const policy = args.policy ?? retentionPolicyOf(await ctx.db.query('appConfig').first());
    const result = await purgePage(ctx, policy, startedAt);
    const counts = addCounts(args.counts ?? emptyCounts(), result.counts);
    if (result.moreLeft && page < PURGE_MAX_PAGES) {
      await ctx.scheduler.runAfter(0, internal.features.retention.internal.runPurge, {
        startedAt,
        page: page + 1,
        counts,
        policy,
      });
      return null;
    }
    // Safety net: memberships are kept in step on every write, a full recount catches what a bug left behind.
    for (const list of await loadDynamicLists(ctx)) await startDynamicListRecalc(ctx, list);
    await logAudit({
      ctx,
      entityType: 'retention',
      entityId: 'purge',
      action: 'delete',
      metadata: {
        startedAt,
        finishedAt: Date.now(),
        pages: page,
        truncated: result.moreLeft,
        policy,
        counts,
      },
    });
    return null;
  },
});
