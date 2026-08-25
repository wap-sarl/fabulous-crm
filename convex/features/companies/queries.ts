import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import type { Doc } from '../../_generated/dataModel';
import { employeeQuery } from '../../_lib/auth';
import { isNotDeleted } from '../../_lib/softDelete';
import { countLiveCompanies, countLiveLeadsByCompany } from '../../lib/companyAggregates';
import { normalizeSearchText } from '../../lib/leadSearch';

/** A list row: the company plus its live contact count (aggregate, O(log n)). */
async function withContactCount(
  ctx: Parameters<typeof countLiveLeadsByCompany>[0],
  company: Doc<'companies'>,
) {
  return { ...company, contactCount: await countLiveLeadsByCompany(ctx, company._id) };
}

/**
 * Companies list, cursor-paginated: the search index when a term is given,
 * else name order. Soft-deleted rows are filtered per page.
 */
export const listCompaniesPaginated = employeeQuery({
  args: { paginationOpts: paginationOptsValidator, search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const term = args.search ? normalizeSearchText(args.search) : '';
    const result = term
      ? await ctx.db
          .query('companies')
          .withSearchIndex('by_searchText', (q) => q.search('searchText', term))
          .paginate(args.paginationOpts)
      : await ctx.db
          .query('companies')
          .withIndex('by_name')
          .order('asc')
          .paginate(args.paginationOpts);
    const page = [];
    for (const company of result.page) {
      if (isNotDeleted(company)) page.push(await withContactCount(ctx, company));
    }
    return { ...result, page };
  },
});

/** Live company count for the list header. */
export const countCompanies = employeeQuery({
  args: {},
  handler: async (ctx) => ({ total: await countLiveCompanies(ctx) }),
});

/**
 * Quick lookup for the lead form picker: up to 10 live companies matching a
 * search term (or the first 10 by name when empty).
 */
export const searchCompanies = employeeQuery({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const term = args.search ? normalizeSearchText(args.search) : '';
    const rows = term
      ? await ctx.db
          .query('companies')
          .withSearchIndex('by_searchText', (q) => q.search('searchText', term))
          .take(20)
      : await ctx.db.query('companies').withIndex('by_name').order('asc').take(20);
    return rows
      .filter(isNotDeleted)
      .slice(0, 10)
      .map((c) => ({ _id: c._id, name: c.name, domain: c.domain ?? null }));
  },
});

export const getCompany = employeeQuery({
  args: { companyId: v.id('companies') },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company || !isNotDeleted(company)) return null;
    return await withContactCount(ctx, company);
  },
});

/**
 * Company page activity: its audit trail (create/update/delete by whom), most
 * recent first. Bounded by the number of edits of one company.
 */
export const listCompanyActivity = employeeQuery({
  args: { companyId: v.id('companies') },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query('auditLogs')
      .withIndex('by_entity', (q) => q.eq('entityType', 'company').eq('entityId', args.companyId))
      .order('desc')
      .take(50);
    const names = new Map<string, string | null>();
    for (const log of logs) {
      if (!names.has(log.userId)) {
        const user = await ctx.db.get(log.userId);
        names.set(log.userId, user ? `${user.firstName} ${user.lastName}` : null);
      }
    }
    return logs.map((log) => ({
      _id: log._id,
      action: log.action,
      timestamp: log.timestamp,
      userName: names.get(log.userId) ?? null,
      metadata: log.metadata ?? null,
    }));
  },
});
