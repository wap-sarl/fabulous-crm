import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import type { QueryCtx } from '../../_generated/server';
import { ownerNamespaces } from '../../lib/visibility';
import type { Doc } from '../../_generated/dataModel';
import { isNotDeleted } from '../../_lib/softDelete';
import { renderPlaceholders, wrapEmailHtml } from '../../lib/emailUtils';
import { countLiveLeadsByLifecycleStage, countLiveLeadsByOwner } from '../../lib/leadAggregates';
import { loadLifecycleConfig } from '../../lib/lifecycle';
import { normalizeSearchText } from '../../lib/leadSearch';
import { leadListMemberCounts } from '../../lib/leadListMembers';
import { DEFAULT_MAX_DYNAMIC_LISTS } from '../../_lib/validators/leadLists';
import {
  leadFilterArgs,
  loadAdvancedListMembers,
  loadListMemberIds,
  loadListMemberIdsForLeads,
  matchesLeadFilters,
} from './leadTableFilters';

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

    // Indexable prefix: only single-value selections can ride an index range
    // (a multi-select would need a union of ranges, which one cursor can't do).
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

    // Residual predicates, applied per page. List membership is resolved for
    // the page's leads only (indexed point reads — a full member-set load is
    // unbounded on large lists). Re-checking the indexed predicates is
    // harmless: the index range only narrowed what was read.
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
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) return null;
    return lead;
  },
});

/**
 * Lead detail page payload: the lead, its assignee's display name and its
 * company. History lives in `features/timeline/queries.listLeadTimeline`.
 */
export const getLeadDetail = employeeQuery({
  args: { leadId: v.id('leads') },
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

/**
 * Notes attached to a lead, enriched with each author's display name. Sorted
 * pinned-first, then most-recent. Soft-deleted notes are excluded.
 */
export const listLeadNotes = employeeQuery({
  args: { leadId: v.id('leads') },
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

/**
 * Resolve the full set of lead ids matching a filter, for building a campaign
 * "from the current filter". Non-paginated bounded collect — fine for a few
 * thousand leads.
 */
export const listMatchingLeadIds = employeeQuery({
  args: { ...leadFilterArgs },
  handler: async (ctx, args) => {
    const listMemberIds = await loadListMemberIds(ctx, args.listIds);
    const advancedListMembers = await loadAdvancedListMembers(ctx, args.advancedFilter);
    const all = await ctx.db.query('leads').collect();
    const matching = all.filter((lead) =>
      matchesLeadFilters(lead, { ...args, listMemberIds, advancedListMembers }),
    );
    return {
      leadIds: matching.map((lead) => lead._id),
      total: matching.length,
      withEmail: matching.filter((lead) => !!lead.email).length,
      withPhone: matching.filter((lead) => !!lead.phone).length,
    };
  },
});

/**
 * All lead lists (most recent first) with their member count and importer name.
 * Feeds both the lists settings page and the list-filter dropdowns. Member
 * counts come from the `leadListMemberCounts` aggregate — the junction table
 * grows as leads × lists, so scanning it here would hit Convex's read limit
 * long before the leads table itself does (#14).
 */
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

export const listCampaigns = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db.query('campaigns').order('desc').collect();
    return campaigns.filter(isNotDeleted);
  },
});

/**
 * Reconstruct the message a recipient sees by re-rendering the campaign template
 * against `params` (per-lead merge values). Reuses the exact send-path helpers
 * (`renderPlaceholders`/`wrapEmailHtml`) so the preview can never drift from what
 * was actually sent. Pass an empty `params` to preview the raw template with the
 * `{{ params.x }}` placeholders left visible. Brevo-template campaigns keep their
 * HTML on Brevo's side, so we can only surface the template id — the UI renders an
 * "aperçu indisponible" note for those.
 */
function buildMessagePreview(campaign: Doc<'campaigns'>, params: Record<string, string>) {
  const channel = campaign.channel ?? 'email';
  if (channel === 'sms') {
    return {
      channel,
      sms: campaign.smsBody ? renderPlaceholders(campaign.smsBody, params, false) : undefined,
    };
  }
  if (campaign.brevoTemplateId !== undefined) {
    return { channel, templateId: campaign.brevoTemplateId };
  }
  return {
    channel,
    subject: campaign.subject ? renderPlaceholders(campaign.subject, params, false) : undefined,
    html: campaign.htmlBody
      ? wrapEmailHtml(renderPlaceholders(campaign.htmlBody, params))
      : undefined,
  };
}

export const getCampaign = employeeQuery({
  args: { campaignId: v.id('campaigns') },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || !isNotDeleted(campaign)) return null;
    const sends = await ctx.db
      .query('campaignSends')
      .withIndex('by_campaign', (q) => q.eq('campaignId', args.campaignId))
      .collect();
    // The message "as authored" — placeholders left visible (empty params).
    const messagePreview = buildMessagePreview(campaign, {});
    return { campaign, sends, messagePreview };
  },
});

/**
 * Delivery/engagement events of a campaign, newest first. Cursor-paginated
 * natively (unlike the leads table): campaignEvents is append-only and fully
 * served by the `by_campaign_eventAt` index prefix — no in-memory filtering,
 * so a page can never hide matches.
 */
export const listCampaignEvents = employeeQuery({
  args: { campaignId: v.id('campaigns'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) =>
    ctx.db
      .query('campaignEvents')
      .withIndex('by_campaign_eventAt', (q) => q.eq('campaignId', args.campaignId))
      .order('desc')
      .paginate(args.paginationOpts),
});

/**
 * Reconstruct what a single recipient received: the campaign template rendered
 * with that send's stored merge `params`, plus the send's event timeline.
 * Lazily fetched when a recipient's preview drawer is opened, so we never
 * render for every send up front.
 */
export const getCampaignSendPreview = employeeQuery({
  args: { sendId: v.id('campaignSends') },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send) return null;
    const campaign = await ctx.db.get(send.campaignId);
    if (!campaign || !isNotDeleted(campaign)) return null;

    const firstName = send.params.firstName ?? '';
    const lastName = send.params.lastName ?? '';
    const leadName = `${firstName} ${lastName}`.trim();

    const events = await ctx.db
      .query('campaignEvents')
      .withIndex('by_send', (q) => q.eq('sendId', args.sendId))
      .collect();

    return {
      leadName: leadName || null,
      contact: send.email ?? send.phone ?? null,
      status: send.status,
      sentAt: send.sentAt,
      openedAt: send.openedAt,
      clickedAt: send.clickedAt,
      error: send.error,
      params: send.params,
      events: events.sort((a, b) => b.eventAt - a.eventAt),
      ...buildMessagePreview(campaign, send.params),
    };
  },
});

/**
 * PUBLIC (no auth): resolve a lead's current marketing consent from its
 * persistent consent token, for the unauthenticated RGPD consent page.
 * Returns only the minimal data needed to render the form.
 */
export const getConsentByToken = query({
  args: { token: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const lead = await getLeadByConsentToken(ctx, args.token);
    if (!lead) return null;
    return {
      firstName: lead.firstName,
      lastName: lead.lastName,
      marketingConsent: lead.marketingConsent,
    };
  },
});

export async function getLeadByConsentToken(
  ctx: QueryCtx,
  token: string,
): Promise<Doc<'leads'> | null> {
  if (!token) return null;
  const lead = await ctx.db
    .query('leads')
    .withIndex('by_consentToken', (q) => q.eq('consentToken', token))
    .first();
  if (!lead || !isNotDeleted(lead)) return null;
  return lead;
}
