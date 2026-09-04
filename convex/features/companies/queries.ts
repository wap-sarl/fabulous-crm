import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import type { Doc } from '../../_generated/dataModel';
import { employeeQuery } from '../../_lib/auth';
import { isNotDeleted } from '../../_lib/softDelete';
import {
  type CompanyStandardField,
  type FilterField,
  companyAdvancedFilterValidator,
} from '../../_lib/validators/filters';
import type { PropertyValue } from '../../_lib/validators/properties';
import { evalFilter } from '../../lib/filterMatching';
import {
  countLiveCompanies,
  countLiveCompaniesByOwner,
  countLiveLeadsByCompany,
} from '../../lib/companyAggregates';
import { ownerNamespaces } from '../../lib/visibility';
import { normalizeSearchText } from '../../lib/leadSearch';
import { findCompanyByDomain } from '../../lib/companies';
import { companyDomainOfEmail } from '../../lib/companyDomains';

/** A list row: the company plus its live contact count (aggregate, O(log n)). */
async function withContactCount(
  ctx: Parameters<typeof countLiveLeadsByCompany>[0],
  company: Doc<'companies'>,
) {
  return { ...company, contactCount: await countLiveLeadsByCompany(ctx, company._id) };
}

export function getCompanyFieldValue(
  company: Doc<'companies'>,
  field: FilterField<CompanyStandardField>,
): PropertyValue | undefined {
  if (field.kind === 'custom') return company.customProperties?.[field.definitionId];
  switch (field.field) {
    case 'name':
      return company.name;
    case 'domain':
      return company.domain;
    case 'country':
      return company.country;
    case 'website':
      return company.website;
    case 'sector':
      return company.sector;
    case 'headcount':
      return company.headcount;
    case 'createdAt':
      return company._creationTime;
  }
}

/**
 * Companies list, cursor-paginated: the search index when a term is given,
 * else name order. Soft-deleted rows and rows outside the advanced filter are
 * filtered per page.
 */
export const listCompaniesPaginated = employeeQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    advancedFilter: v.optional(companyAdvancedFilterValidator),
  },
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
      if (!isNotDeleted(company)) continue;
      if (
        args.advancedFilter &&
        !evalFilter((field) => getCompanyFieldValue(company, field), args.advancedFilter)
      ) {
        continue;
      }
      page.push(await withContactCount(ctx, company));
    }
    return { ...result, page };
  },
});

/** Live company count for the list header. */
export const countCompanies = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const namespaces = ownerNamespaces(ctx.visibility, 'companies');
    if (namespaces === 'all') return { total: await countLiveCompanies(ctx) };
    if (namespaces === 'none') return { total: 0 };
    let total = 0;
    for (const owner of namespaces) total += await countLiveCompaniesByOwner(ctx, owner);
    return { total };
  },
});

/** Live companies as filter options (id + name), name order — feeds the « Entreprise » field. */
export const listCompanyOptions = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('companies').withIndex('by_name').order('asc').collect();
    return rows.filter(isNotDeleted).map((c) => ({ _id: c._id, name: c.name }));
  },
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

export const findCompanyByEmailDomain = employeeQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const domain = companyDomainOfEmail(args.email);
    if (!domain) return null;
    const company = await findCompanyByDomain(ctx, domain);
    return company ? { _id: company._id, name: company.name, domain } : null;
  },
});

export const getCompany = employeeQuery({
  args: { companyId: v.id('companies') },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company || !isNotDeleted(company)) return null;
    const ownerNames: string[] = [];
    for (const id of company.ownerIds) {
      const owner = await ctx.db.get(id);
      if (owner) ownerNames.push(`${owner.firstName} ${owner.lastName}`);
    }
    return { ...(await withContactCount(ctx, company)), ownerNames };
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
    const actorName = async (log: (typeof logs)[number]): Promise<string | null> => {
      const id = log.apiKeyId ?? log.userId;
      if (!id) return null;
      if (!names.has(id)) {
        if (log.apiKeyId) {
          const key = await ctx.db.get(log.apiKeyId);
          names.set(id, key ? `API · ${key.name}` : 'API');
        } else if (log.userId) {
          const user = await ctx.db.get(log.userId);
          names.set(id, user ? `${user.firstName} ${user.lastName}` : null);
        }
      }
      return names.get(id) ?? null;
    };
    const out = [];
    for (const log of logs) {
      out.push({
        _id: log._id,
        action: log.action,
        timestamp: log.timestamp,
        userName: await actorName(log),
        metadata: log.metadata ?? null,
      });
    }
    return out;
  },
});
