import { paginationResultValidator } from 'convex/server';
import { docOf } from '../../lib/shared/docs';
import { lifecycleChangeSourceValidator } from '../../_lib/validators/lifecycle';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { employeeQuery } from '../../_lib/auth';
import type { QueryCtx } from '../../_generated/server';
import { ownerNamespaces } from '../../lib/roles/visibility';
import type { Doc } from '../../_generated/dataModel';
import { isNotDeleted } from '../../_lib/softDelete';
import { countLiveLeadsByLifecycleStage, countLiveLeadsByOwner } from '../../lib/leads/aggregates';
import { loadLifecycleConfig } from '../../lib/leads/lifecycle';
import { normalizeSearchText } from '../../lib/leads/search';
import {
  leadFilterArgs,
  loadAdvancedListMembers,
  loadListMemberIdsForLeads,
  matchesLeadFilters,
} from '../../lib/leads/tableFilters';

const sortFieldValidator = v.union(
  v.literal('recent'),
  v.literal('lastName'),
  v.literal('lifecycleStage'),
  v.literal('leadScore'),
);
const sortDirectionValidator = v.union(v.literal('asc'), v.literal('desc'));

async function withCompanyNames(ctx: QueryCtx, page: Doc<'leads'>[]) {
  const names = new Map<string, string | null>();
  const out: (Doc<'leads'> & { companyName: string | null })[] = [];
  for (const lead of page) {
    let companyName: string | null = null;
    if (lead.companyId) {
      if (!names.has(lead.companyId)) {
        const company = await ctx.db.get(lead.companyId);
        names.set(lead.companyId, company && isNotDeleted(company) ? company.name : null);
      }
      companyName = names.get(lead.companyId) ?? null;
    }
    out.push({ ...lead, companyName });
  }
  return out;
}

export const listLeadsPaginated = employeeQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    sortField: v.optional(sortFieldValidator),
    sortDirection: v.optional(sortDirectionValidator),
    ...leadFilterArgs,
  },
  returns: paginationResultValidator(
    v.object({ ...docOf('leads').fields, companyName: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx, args) => {
    const direction = args.sortDirection ?? 'desc';
    const sortField = args.sortField ?? 'recent';

    const searchTerm = args.search ? normalizeSearchText(args.search) : '';
    if (searchTerm) {
      const result = await ctx.db
        .query('leads')
        .withSearchIndex('by_searchText', (q) => q.search('searchText', searchTerm))
        .paginate(args.paginationOpts);
      const pageIds = result.page.map((lead) => lead._id);
      const listMemberIds = await loadListMemberIdsForLeads(ctx, args.listIds, pageIds);
      const advancedListMembers = await loadAdvancedListMembers(ctx, args.advancedFilter, pageIds);
      return {
        ...result,
        page: await withCompanyNames(
          ctx,
          result.page.filter((lead) =>
            matchesLeadFilters(lead, {
              ...args,
              search: undefined,
              listMemberIds,
              advancedListMembers,
            }),
          ),
        ),
      };
    }

    // Only a single-value selection can ride an index range: a multi-select needs a union of ranges, which one cursor cannot do.
    const singleStage = args.lifecycleStages?.length === 1 ? args.lifecycleStages[0] : undefined;
    const singleCompany = args.companyIds?.length === 1 ? args.companyIds[0] : undefined;

    const cursor =
      sortField === 'lastName'
        ? ctx.db.query('leads').withIndex('by_lastName').order(direction)
        : sortField === 'leadScore'
          ? ctx.db.query('leads').withIndex('by_leadScore').order(direction)
          : sortField === 'lifecycleStage'
            ? ctx.db.query('leads').withIndex('by_lifecycleStage').order(direction)
            : singleCompany !== undefined
              ? ctx.db
                  .query('leads')
                  .withIndex('by_company', (q) => q.eq('companyId', singleCompany))
                  .order(direction)
              : singleStage !== undefined
                ? ctx.db
                    .query('leads')
                    .withIndex('by_lifecycleStage', (q) => q.eq('lifecycleStage', singleStage))
                    .order(direction)
                : ctx.db.query('leads').order(direction);

    const result = await cursor.paginate(args.paginationOpts);

    // Membership is resolved for the page's leads only, a full member set is unbounded; re-checking the indexed predicates is harmless.
    const pageIds = result.page.map((lead) => lead._id);
    const listMemberIds = await loadListMemberIdsForLeads(ctx, args.listIds, pageIds);
    const advancedListMembers = await loadAdvancedListMembers(ctx, args.advancedFilter, pageIds);
    return {
      ...result,
      page: await withCompanyNames(
        ctx,
        result.page.filter((lead) =>
          matchesLeadFilters(lead, { ...args, listMemberIds, advancedListMembers }),
        ),
      ),
    };
  },
});

export const searchLeads = employeeQuery({
  args: { search: v.optional(v.string()) },
  returns: v.array(
    v.object({
      _id: v.id('leads'),
      name: v.string(),
      email: v.union(v.string(), v.null()),
      companyId: v.union(v.id('companies'), v.null()),
      companyName: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const term = args.search ? normalizeSearchText(args.search) : '';
    const rows = term
      ? await ctx.db
          .query('leads')
          .withSearchIndex('by_searchText', (q) => q.search('searchText', term))
          .take(20)
      : await ctx.db.query('leads').order('desc').take(20);
    const leads = rows.filter(isNotDeleted).slice(0, 10);
    const companyNames = new Map<string, string | null>();
    const out = [];
    for (const l of leads) {
      let companyName: string | null = null;
      if (l.companyId) {
        if (!companyNames.has(l.companyId)) {
          const company = await ctx.db.get(l.companyId);
          companyNames.set(l.companyId, company && isNotDeleted(company) ? company.name : null);
        }
        companyName = companyNames.get(l.companyId) ?? null;
      }
      out.push({
        _id: l._id,
        name: `${l.firstName} ${l.lastName}`,
        email: l.email ?? null,
        companyId: l.companyId ?? null,
        companyName,
      });
    }
    return out;
  },
});

export const getLead = employeeQuery({
  args: { leadId: v.id('leads') },
  returns: v.union(docOf('leads'), v.null()),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) return null;
    return lead;
  },
});

/** The lead detail page payload; its history lives in `features/timeline/queries.listLeadTimeline`. */
export const getLeadDetail = employeeQuery({
  args: { leadId: v.id('leads') },
  returns: v.union(
    v.object({
      lead: docOf('leads'),
      ownerNames: v.array(v.string()),
      company: v.union(
        v.object({
          _id: v.id('companies'),
          name: v.string(),
          domain: v.union(v.string(), v.null()),
        }),
        v.null(),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) return null;

    const ownerNames: string[] = [];
    for (const id of lead.ownerIds) {
      const owner = await ctx.db.get(id);
      if (owner) ownerNames.push(`${owner.firstName} ${owner.lastName}`);
    }
    const companyDoc = lead.companyId ? await ctx.db.get(lead.companyId) : null;
    const company =
      companyDoc && isNotDeleted(companyDoc)
        ? { _id: companyDoc._id, name: companyDoc.name, domain: companyDoc.domain ?? null }
        : null;

    return {
      lead,
      ownerNames,
      company,
    };
  },
});

/** Pinned notes first, then the most recent. */
export const listLeadNotes = employeeQuery({
  args: { leadId: v.id('leads') },
  returns: v.array(
    v.object({
      _id: v.id('leadNotes'),
      content: v.string(),
      isPinned: v.boolean(),
      authorName: v.union(v.string(), v.null()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const notes = (
      await ctx.db
        .query('leadNotes')
        .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
        .collect()
    ).filter(isNotDeleted);

    // Resolve author names once per unique author.
    const authorNames = new Map<string, string | null>();
    for (const note of notes) {
      if (note.createdBy && !authorNames.has(note.createdBy)) {
        const author = await ctx.db.get(note.createdBy);
        authorNames.set(note.createdBy, author ? `${author.firstName} ${author.lastName}` : null);
      }
    }

    return notes
      .map((note) => ({
        _id: note._id,
        content: note.content,
        isPinned: note.isPinned,
        authorName: note.createdBy ? (authorNames.get(note.createdBy) ?? null) : null,
        createdAt: note._creationTime,
        updatedAt: note.updatedAt,
      }))
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  },
});

export const countLeadsByLifecycleStage = employeeQuery({
  args: {},
  returns: v.object({
    byStage: v.record(v.string(), v.number()),
    unset: v.number(),
    total: v.number(),
  }),
  handler: async (ctx) => {
    const config = await loadLifecycleConfig(ctx);
    const byStage: Record<string, number> = {};
    let unset = 0;
    const namespaces = ownerNamespaces(ctx.visibility, 'leads');
    if (namespaces === 'all') {
      for (const stage of config.stages) {
        byStage[stage.key] = await countLiveLeadsByLifecycleStage(ctx, stage.key);
      }
      unset = await countLiveLeadsByLifecycleStage(ctx, null);
    } else if (namespaces === 'none') {
      for (const stage of config.stages) byStage[stage.key] = 0;
    } else {
      for (const stage of config.stages) {
        let n = 0;
        for (const owner of namespaces) n += await countLiveLeadsByOwner(ctx, owner, stage.key);
        byStage[stage.key] = n;
      }
      for (const owner of namespaces) unset += await countLiveLeadsByOwner(ctx, owner, '');
    }
    const total = Object.values(byStage).reduce((a, b) => a + b, 0) + unset;
    return { byStage, unset, total };
  },
});

export const listLifecycleHistory = employeeQuery({
  args: { leadId: v.id('leads') },
  returns: v.array(
    v.object({
      _id: v.id('lifecycleStageHistory'),
      from: v.union(v.string(), v.null()),
      to: v.string(),
      source: lifecycleChangeSourceValidator,
      changedAt: v.number(),
      changedByName: v.union(v.string(), v.null()),
      workflowId: v.union(v.id('workflows'), v.null()),
      workflowName: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('lifecycleStageHistory')
      .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
      .collect();

    const userNames = new Map<string, string | null>();
    const workflowNames = new Map<string, string | null>();
    for (const row of rows) {
      if (row.changedBy && !userNames.has(row.changedBy)) {
        const user = await ctx.db.get(row.changedBy);
        userNames.set(row.changedBy, user ? `${user.firstName} ${user.lastName}` : null);
      }
      if (row.workflowId && !workflowNames.has(row.workflowId)) {
        const workflow = await ctx.db.get(row.workflowId);
        workflowNames.set(row.workflowId, workflow?.name ?? null);
      }
    }

    return rows.map((row) => ({
      _id: row._id,
      from: row.from ?? null,
      to: row.to,
      source: row.source,
      changedAt: row._creationTime,
      changedByName: row.changedBy ? (userNames.get(row.changedBy) ?? null) : null,
      workflowId: row.workflowId ?? null,
      workflowName: row.workflowId ? (workflowNames.get(row.workflowId) ?? null) : null,
    }));
  },
});

const MATCHING_PAGE = 500;

/** One page of the leads matching a filter, and what it counts; the caller follows `cursor` until it is null, so that no call reads the whole table and none is rerun at every write of a lead. */
export const matchingLeadsPage = employeeQuery({
  args: { ...leadFilterArgs, cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    leadIds: v.array(v.id('leads')),
    withEmail: v.number(),
    withPhone: v.number(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor, ...filters }) => {
    const page = await ctx.db.query('leads').paginate({ cursor, numItems: MATCHING_PAGE });
    const pageIds = page.page.map((lead) => lead._id);
    const listMemberIds = await loadListMemberIdsForLeads(ctx, filters.listIds, pageIds);
    const advancedListMembers = await loadAdvancedListMembers(ctx, filters.advancedFilter, pageIds);
    const matching = page.page.filter((lead) =>
      matchesLeadFilters(lead, { ...filters, listMemberIds, advancedListMembers }),
    );
    return {
      leadIds: matching.map((lead) => lead._id),
      withEmail: matching.filter((lead) => !!lead.email).length,
      withPhone: matching.filter((lead) => !!lead.phone).length,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
