import { v } from 'convex/values';
import { internal } from '../../_generated/api';
// Trigger-wrapped constructor: keeps aggregates and searchText in sync.
import { internalMutation } from '../../_lib/functions';
import { leadSearchText } from '../../lib/leadSearch';

const LEADS_BATCH = 200;

/**
 * Re-stamp the searchText of a company's leads after a rename. Each patch
 * goes through the leads trigger, which recomputes the text from the fresh
 * company name; writing the value here just avoids a second corrective write.
 */
export const restampCompanyLeadsSearchText = internalMutation({
  args: { companyId: v.id('companies'), cursor: v.optional(v.string()) },
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
