import { employeeQuery } from '../../_lib/auth';
import { leadListMemberCounts } from '../../lib/leadLists/members';
import { DEFAULT_MAX_DYNAMIC_LISTS } from '../../_lib/validators/leadLists';

/** Member counts come from the aggregate: the junction table grows as leads × lists, and scanning it would hit Convex's read limit (#14). */
export const listLeadLists = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const lists = await ctx.db.query('leadLists').order('desc').collect();

    const counts = new Map<string, number>();
    for (const list of lists) {
      counts.set(
        list._id,
        await leadListMemberCounts.count(ctx, { namespace: list._id, bounds: {} }),
      );
    }

    const creatorNames = new Map<string, string | null>();
    for (const list of lists) {
      if (list.createdBy && !creatorNames.has(list.createdBy)) {
        const creator = await ctx.db.get(list.createdBy);
        creatorNames.set(
          list.createdBy,
          creator ? `${creator.firstName} ${creator.lastName}` : null,
        );
      }
    }

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
  handler: async (ctx) => {
    const lists = await ctx.db.query('leadLists').collect();
    const cfg = await ctx.db.query('appConfig').first();
    return {
      maxDynamicLists: cfg?.lists?.maxDynamicLists ?? DEFAULT_MAX_DYNAMIC_LISTS,
      dynamicCount: lists.filter((l) => l.kind === 'dynamic').length,
    };
  },
});
