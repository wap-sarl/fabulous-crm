import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import type { QueryCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { leadStatusValidator, leadPropertyValueValidator } from '../../schema';
import type { LeadPropertyValue } from '../../_lib/validators/leadProperties';
import { advancedFilterValidator } from '../../_lib/validators/leadFilters';
import type { AdvancedFilter } from '../../_lib/validators/leadFilters';
import { evalAdvancedFilter } from './leadMatching';
import { isNotDeleted } from '../../_lib/softDelete';
import { renderPlaceholders, wrapEmailHtml } from '../../lib/emailUtils';

/** Filter arguments shared by the paginated table and the campaign-resolver query. */
const leadFilterArgs = {
  search: v.optional(v.string()),
  statuses: v.optional(v.array(leadStatusValidator)),
  assignedToIds: v.optional(v.array(v.id('users'))),
  isRedFlagged: v.optional(v.boolean()),
  // Custom-property filters: definitionId -> allowed values. A lead matches a
  // property if its stored value is one of the allowed (OR within a property);
  // it must match every filtered property (AND across properties). Only select
  // and boolean properties are filterable.
  customProperties: v.optional(v.record(v.string(), v.array(leadPropertyValueValidator))),
  // Lead lists a lead must belong to at least one of (OR within the filter).
  // Membership is resolved to a Set of lead ids in the handler before matching.
  listIds: v.optional(v.array(v.id('leadLists'))),
  // Advanced group-based filter (two-level AND/OR tree of typed rules). ANDs
  // with the flat quick filters above. See convex/_lib/validators/leadFilters.ts.
  advancedFilter: v.optional(advancedFilterValidator),
} as const;

const sortFieldValidator = v.union(v.literal('recent'), v.literal('lastName'), v.literal('status'));
const sortDirectionValidator = v.union(v.literal('asc'), v.literal('desc'));

type LeadFilters = {
  search?: string;
  statuses?: Doc<'leads'>['status'][];
  assignedToIds?: Doc<'leads'>['assignedTo'][];
  isRedFlagged?: boolean;
  customProperties?: Record<string, LeadPropertyValue[]>;
  listIds?: Id<'leadLists'>[];
  // Resolved membership for `listIds`, computed once per query (not a raw arg).
  listMemberIds?: Set<string>;
  advancedFilter?: AdvancedFilter;
};

/**
 * Resolve the set of lead ids belonging to any of `listIds` (OR semantics),
 * via the `by_list_lead` junction index. Returns undefined when no list filter
 * is active so the matcher can skip the check entirely.
 */
async function loadListMemberIds(
  ctx: QueryCtx,
  listIds: Id<'leadLists'>[] | undefined,
): Promise<Set<string> | undefined> {
  if (!listIds || listIds.length === 0) return undefined;
  const ids = new Set<string>();
  for (const listId of listIds) {
    const members = await ctx.db
      .query('leadListMembers')
      .withIndex('by_list_lead', (q) => q.eq('listId', listId))
      .collect();
    for (const member of members) ids.add(member.leadId);
  }
  return ids;
}

function matchesLeadFilters(lead: Doc<'leads'>, filters: LeadFilters): boolean {
  if (!isNotDeleted(lead)) return false;

  if (filters.statuses && filters.statuses.length > 0) {
    if (!filters.statuses.includes(lead.status)) return false;
  }

  if (filters.assignedToIds && filters.assignedToIds.length > 0) {
    if (!lead.assignedTo || !filters.assignedToIds.includes(lead.assignedTo)) return false;
  }

  if (typeof filters.isRedFlagged === 'boolean') {
    if (lead.isRedFlagged !== filters.isRedFlagged) return false;
  }

  if (filters.listIds && filters.listIds.length > 0) {
    if (!filters.listMemberIds?.has(lead._id)) return false;
  }

  const search = filters.search?.toLowerCase().trim();
  if (search) {
    const haystacks = [lead.firstName, lead.lastName, lead.email, lead.phone];
    const matched = haystacks.some((value) => value?.toLowerCase().includes(search));
    if (!matched) return false;
  }

  if (filters.customProperties) {
    for (const [definitionId, allowed] of Object.entries(filters.customProperties)) {
      if (!allowed || allowed.length === 0) continue;
      const value = lead.customProperties?.[definitionId];
      if (value === undefined) return false;
      // checkbox values are arrays — match when the selection intersects `allowed`.
      const matched = Array.isArray(value)
        ? value.some((v) => allowed.includes(v))
        : allowed.includes(value);
      if (!matched) return false;
    }
  }

  if (filters.advancedFilter && !evalAdvancedFilter(lead, filters.advancedFilter)) {
    return false;
  }

  return true;
}

const DEFAULT_PAGE_SIZE = 30;

/**
 * Filterable, sortable leads list for the CRM table.
 *
 * Convex cursor pagination paginates the raw table *before* our in-memory
 * filter runs, so a matching lead outside the first page would be hidden until
 * the client paged all the way to it (slow, and disagreed with the status-chip
 * counts). Instead we do a single bounded scan — collect in the sort order, then
 * filter — matching `listMatchingLeadIds`/`countLeadsByStatus` (fine for a few
 * thousand leads). The client grows `limit` to reveal more rows; `total` is the
 * full filtered count so the caller knows whether more remain.
 */
export const listLeadsPaginated = employeeQuery({
  args: {
    limit: v.optional(v.number()),
    sortField: v.optional(sortFieldValidator),
    sortDirection: v.optional(sortDirectionValidator),
    ...leadFilterArgs,
  },
  handler: async (ctx, args) => {
    const direction = args.sortDirection ?? 'desc';
    const sortField = args.sortField ?? 'recent';

    const cursor =
      sortField === 'lastName'
        ? ctx.db.query('leads').withIndex('by_lastName').order(direction)
        : sortField === 'status'
          ? ctx.db.query('leads').withIndex('by_status').order(direction)
          : ctx.db.query('leads').order(direction);

    const listMemberIds = await loadListMemberIds(ctx, args.listIds);
    const all = await cursor.collect();
    const matching = all.filter((lead) => matchesLeadFilters(lead, { ...args, listMemberIds }));

    const limit = args.limit ?? DEFAULT_PAGE_SIZE;
    return { page: matching.slice(0, limit), total: matching.length };
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
 * Lead detail page payload: the lead, its assignee's display name, and the
 * campaigns it was enrolled in (via campaignSends, most recent first).
 */
export const getLeadDetail = employeeQuery({
  args: { leadId: v.id('leads') },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) return null;

    const assignee = lead.assignedTo ? await ctx.db.get(lead.assignedTo) : null;

    const sends = await ctx.db
      .query('campaignSends')
      .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
      .collect();
    const campaigns = (
      await Promise.all(
        sends.map(async (send) => {
          const campaign = await ctx.db.get(send.campaignId);
          if (!campaign || !isNotDeleted(campaign)) return null;
          return {
            campaignId: campaign._id,
            name: campaign.name,
            campaignStatus: campaign.status,
            sendStatus: send.status,
            sentAt: send.sentAt,
          };
        }),
      )
    )
      .filter((c) => c !== null)
      .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));

    return {
      lead,
      assignedToName: assignee ? `${assignee.firstName} ${assignee.lastName}` : null,
      campaigns,
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

/**
 * Global lead counts per status for the list filter chips. Bounded collect,
 * same trade-off as listMatchingLeadIds.
 */
export const countLeadsByStatus = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('leads').collect();
    const leads = all.filter(isNotDeleted);
    const byStatus: Record<Doc<'leads'>['status'], number> = {
      nouveau: 0,
      contacte: 0,
      interesse: 0,
      converti: 0,
      perdu: 0,
    };
    for (const lead of leads) byStatus[lead.status] += 1;
    return { total: leads.length, byStatus };
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
    const all = await ctx.db.query('leads').collect();
    const matching = all.filter((lead) => matchesLeadFilters(lead, { ...args, listMemberIds }));
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
 * counts are tallied in a single pass over the junction table.
 */
export const listLeadLists = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const lists = await ctx.db.query('leadLists').order('desc').collect();

    const members = await ctx.db.query('leadListMembers').collect();
    const counts = new Map<string, number>();
    for (const member of members) {
      counts.set(member.listId, (counts.get(member.listId) ?? 0) + 1);
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
      memberCount: counts.get(list._id) ?? 0,
      createdByName: list.createdBy ? (creatorNames.get(list.createdBy) ?? null) : null,
      createdAt: list._creationTime,
    }));
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
