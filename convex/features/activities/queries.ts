import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import { UNDATED_KEY, activityStatusValidator } from '../../_lib/validators/activities';
import { isNotDeleted } from '../../lib';
import { countActivitiesDue } from '../../lib/activityAggregates';

export type ActivityRow = Doc<'activities'> & {
  ownerName: string | null;
  leadName: string | null;
  companyName: string | null;
  dealTitle: string | null;
};

/** Attach the names a row displays (memoized point reads per page). */
async function withRelations(ctx: QueryCtx, rows: Doc<'activities'>[]): Promise<ActivityRow[]> {
  const cache = new Map<string, string | null>();
  const nameOf = async <T extends 'users' | 'leads' | 'companies' | 'deals'>(
    id: Id<T> | undefined,
    render: (doc: Doc<T>) => string,
  ): Promise<string | null> => {
    if (!id) return null;
    if (!cache.has(id)) {
      const doc = (await ctx.db.get(id)) as Doc<T> | null;
      cache.set(id, doc && isNotDeleted(doc as { deletedAt?: number }) ? render(doc) : null);
    }
    return cache.get(id) ?? null;
  };
  const out: ActivityRow[] = [];
  for (const a of rows) {
    out.push({
      ...a,
      ownerName: await nameOf(a.ownerId, (u) => `${u.firstName} ${u.lastName}`),
      leadName: await nameOf(a.leadId, (l) => `${l.firstName} ${l.lastName}`),
      companyName: await nameOf(a.companyId, (c) => c.name),
      dealTitle: await nameOf(a.dealId, (d) => d.title),
    });
  }
  return out;
}

export const listTasks = employeeQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    ownerId: v.optional(v.id('users')),
    status: v.optional(activityStatusValidator),
    dueFrom: v.optional(v.number()),
    dueBefore: v.optional(v.number()),
    undated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerId = args.ownerId ?? ctx.userId;
    const status = args.status ?? 'open';
    const result = await ctx.db
      .query('activities')
      .withIndex('by_owner_status_dueAt', (q) => {
        const base = q.eq('ownerId', ownerId).eq('status', status);
        if (args.undated) return base.eq('dueAt', undefined);
        if (args.dueFrom !== undefined && args.dueBefore !== undefined) {
          return base.gte('dueAt', args.dueFrom).lt('dueAt', args.dueBefore);
        }
        if (args.dueFrom !== undefined) return base.gte('dueAt', args.dueFrom);
        if (args.dueBefore !== undefined)
          return base.gte('dueAt', UNDATED_KEY + 1).lt('dueAt', args.dueBefore);
        return base;
      })
      .order(status === 'open' ? 'asc' : 'desc')
      .paginate(args.paginationOpts);
    return { ...result, page: await withRelations(ctx, result.page.filter(isNotDeleted)) };
  },
});

export const countTaskBuckets = employeeQuery({
  args: {
    ownerId: v.optional(v.id('users')),
    startOfToday: v.number(),
    endOfToday: v.number(),
    endOfWeek: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerId = args.ownerId ?? ctx.userId;
    const count = (from: number, to: number) => countActivitiesDue(ctx, ownerId, 'open', from, to);
    return {
      overdue: await count(UNDATED_KEY + 1, args.startOfToday),
      today: await count(args.startOfToday, args.endOfToday),
      week: await count(args.endOfToday, args.endOfWeek),
      later: await count(args.endOfWeek, Number.MAX_SAFE_INTEGER),
      undated: await count(UNDATED_KEY, UNDATED_KEY + 1),
    };
  },
});

/** The activities linked to a lead, company or transaction — open first, then most recent. */
export const listActivitiesForEntity = employeeQuery({
  args: {
    leadId: v.optional(v.id('leads')),
    companyId: v.optional(v.id('companies')),
    dealId: v.optional(v.id('deals')),
  },
  handler: async (ctx, args) => {
    const rows = args.leadId
      ? await ctx.db
          .query('activities')
          .withIndex('by_lead', (q) => q.eq('leadId', args.leadId!))
          .order('desc')
          .take(100)
      : args.companyId
        ? await ctx.db
            .query('activities')
            .withIndex('by_company', (q) => q.eq('companyId', args.companyId!))
            .order('desc')
            .take(100)
        : args.dealId
          ? await ctx.db
              .query('activities')
              .withIndex('by_deal', (q) => q.eq('dealId', args.dealId!))
              .order('desc')
              .take(100)
          : [];
    const live = rows.filter(isNotDeleted).sort((a, b) => {
      if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
      if (a.status === 'open')
        return (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER);
      return (b.completedAt ?? b._creationTime) - (a.completedAt ?? a._creationTime);
    });
    return await withRelations(ctx, live);
  },
});
