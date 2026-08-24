import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { isNotDeleted } from '../../_lib/softDelete';
import { renderPlaceholders, wrapEmailHtml } from '../../lib/emailUtils';
import { countLiveLeadsByStatus } from '../../lib/leadAggregates';
import { leadListMemberCounts } from '../../lib/leadListMembers';
import {
  leadFilterArgs,
  loadListMemberIds,
  loadListMemberIdsForLeads,
  matchesLeadFilters,
} from './leadTableFilters';

const sortFieldValidator = v.union(v.literal('recent'), v.literal('lastName'), v.literal('status'));
const sortDirectionValidator = v.union(v.literal('asc'), v.literal('desc'));

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

    // Indexable prefix: only single-value selections can ride an index range
    // (a multi-select would need a union of ranges, which one cursor can't do).
    const singleStatus = args.statuses?.length === 1 ? args.statuses[0] : undefined;
    const singleAssignee = args.assignedToIds?.length === 1 ? args.assignedToIds[0] : undefined;

    const cursor =
      sortField === 'lastName'
        ? ctx.db.query('leads').withIndex('by_lastName').order(direction)
        : sortField === 'status'
          ? ctx.db.query('leads').withIndex('by_status').order(direction)
          : singleAssignee !== undefined
            ? ctx.db
                .query('leads')
                .withIndex('by_assignedTo_status', (q) =>
                  singleStatus !== undefined
                    ? q.eq('assignedTo', singleAssignee).eq('status', singleStatus)
                    : q.eq('assignedTo', singleAssignee),
                )
                .order(direction)
            : singleStatus !== undefined
              ? ctx.db
                  .query('leads')
                  .withIndex('by_status', (q) => q.eq('status', singleStatus))
                  .order(direction)
              : ctx.db.query('leads').order(direction);

    const result = await cursor.paginate(args.paginationOpts);

    // Residual predicates, applied per page. List membership is resolved for
    // the page's leads only (indexed point reads — a full member-set load is
    // unbounded on large lists). Re-checking the indexed predicates is
    // harmless: the index range only narrowed what was read.
    const listMemberIds = await loadListMemberIdsForLeads(
      ctx,
      args.listIds,
      result.page.map((lead) => lead._id),
    );
    return {
      ...result,
      page: result.page.filter((lead) => matchesLeadFilters(lead, { ...args, listMemberIds })),
    };
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
 * Global lead counts per status for the list filter chips, served by the
 * `leadsByStatus` aggregate (#13) — O(log n) per status, no table scan. The
 * total is the sum of the five statuses, which also gives the paginated list
 * its exact overall count.
 */
export const countLeadsByStatus = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const statuses = ['nouveau', 'contacte', 'interesse', 'converti', 'perdu'] as const;
    const byStatus: Record<Doc<'leads'>['status'], number> = {
      nouveau: 0,
      contacte: 0,
      interesse: 0,
      converti: 0,
      perdu: 0,
    };
    let total = 0;
    for (const status of statuses) {
      const n = await countLiveLeadsByStatus(ctx, status);
      byStatus[status] = n;
      total += n;
    }
    return { total, byStatus };
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
