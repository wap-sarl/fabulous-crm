import { v } from 'convex/values';
import { internal } from '../../_generated/api';
// Trigger-wrapped constructor: keeps aggregates and searchText in sync.
import { internalMutation } from '../../_lib/functions';
import { leadSearchText } from '../../lib/leads/search';

const LEADS_BATCH = 200;

/** After a rename: the leads trigger recomputes searchText on each patch anyway, writing the value here only avoids a second corrective write. */
export const restampCompanyLeadsSearchText = internalMutation({
  args: { companyId: v.id('companies'), cursor: v.optional(v.string()) },
  returns: v.object({ isDone: v.boolean(), continueCursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, args): Promise<{ isDone: boolean; continueCursor: string | null }> => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return { isDone: true, continueCursor: null };
    const page = await ctx.db
      .query('leads')
      .withIndex('by_company', (q) => q.eq('companyId', args.companyId))
      .paginate({ cursor: args.cursor ?? null, numItems: LEADS_BATCH });
    for (const lead of page.page) {
      const expected = leadSearchText(lead, company.name);
      if (lead.searchText !== expected) await ctx.db.patch(lead._id, { searchText: expected });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.companies.internal.restampCompanyLeadsSearchText,
        { companyId: args.companyId, cursor: page.continueCursor },
      );
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Clear `companyId` on the leads of a deleted company, in batches. */
export const detachCompanyLeads = internalMutation({
  args: { companyId: v.id('companies') },
  returns: v.object({ isDone: v.boolean(), detached: v.number() }),
  handler: async (ctx, args): Promise<{ isDone: boolean; detached: number }> => {
    // No cursor: each batch removes its rows from the index range.
    const page = await ctx.db
      .query('leads')
      .withIndex('by_company', (q) => q.eq('companyId', args.companyId))
      .take(LEADS_BATCH);
    for (const lead of page) {
      await ctx.db.patch(lead._id, { companyId: undefined });
    }
    const isDone = page.length < LEADS_BATCH;
    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.features.companies.internal.detachCompanyLeads, {
        companyId: args.companyId,
      });
    }
    return { isDone, detached: page.length };
  },
});
