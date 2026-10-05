import { v } from 'convex/values';
import { leadAdvancedFilterValidator } from '../../_lib/validators/filters';
import { employeeQuery } from '../../_lib/auth';
import { leadListMemberCounts } from '../../lib/leadLists/members';
import { internal } from '../../_generated/api';

/** Member counts come from the aggregate: the junction table grows as leads × lists, and scanning it would hit Convex's read limit (#14). */
export const listLeadLists = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('leadLists'),
      name: v.string(),
      kind: v.union(v.literal('static'), v.literal('dynamic')),
      criteria: v.union(leadAdvancedFilterValidator, v.null()),
      lastRecalcAt: v.union(v.number(), v.null()),
      recalcProcessed: v.union(v.number(), v.null()),
      memberCount: v.number(),
      createdByName: v.union(v.string(), v.null()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const lists = await ctx.db.query('leadLists').order('desc').collect();

    // The counts and the creators are read together, each creator once.
    const creatorIds = [...new Set(lists.flatMap((l) => (l.createdBy ? [l.createdBy] : [])))];
    const [memberCounts, creators] = await Promise.all([
      Promise.all(
        lists.map((list) => leadListMemberCounts.count(ctx, { namespace: list._id, bounds: {} })),
      ),
      Promise.all(creatorIds.map((id) => ctx.db.get(id))),
    ]);
    const counts = new Map(lists.map((list, i) => [list._id as string, memberCounts[i]]));
    const creatorNames = new Map(
      creatorIds.map((id, i) => {
        const creator = creators[i];
        return [id as string, creator ? `${creator.firstName} ${creator.lastName}` : null];
      }),
    );

    return lists.map((list) => ({
      _id: list._id,
      name: list.name,
      kind: list.kind ?? ('static' as const),
      criteria: list.criteria ?? null,
      lastRecalcAt: list.lastRecalcAt ?? null,
      recalcProcessed: list.recalc?.processed ?? null,
      memberCount: counts.get(list._id) ?? 0,
      createdByName: list.createdBy ? (creatorNames.get(list.createdBy) ?? null) : null,
      createdAt: list._creationTime,
    }));
  },
});

/** Dynamic-list cap and current usage, for the « Nouvelle liste dynamique » button. */
export const getListLimits = employeeQuery({
  args: {},
  returns: v.object({ maxDynamicLists: v.number(), dynamicCount: v.number() }),
  handler: (ctx): Promise<{ maxDynamicLists: number; dynamicCount: number }> =>
    ctx.runQuery(internal.features.leadLists.internal.dynamicListLimits, {}),
});
