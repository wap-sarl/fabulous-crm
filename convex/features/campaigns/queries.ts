import { paginationResultValidator } from 'convex/server';
import { docOf } from '../../lib/shared/docs';
import {
  campaignChannelValidator,
  campaignSendStatusValidator,
  campaignStatsValidator,
  campaignStatusValidator,
} from '../../_lib/validators/crm';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { employeeQuery } from '../../_lib/auth';
import type { Doc, Id } from '../../_generated/dataModel';
import { isNotDeleted } from '../../_lib/softDelete';
import { emptyStats } from '../../lib/campaigns/stats';
import { renderPlaceholders, wrapEmailHtml } from '../../lib/email/brevo';

/** What the list shows of a campaign: its counts, never its content. */
const campaignSummaryValidator = v.object({
  _id: v.id('campaigns'),
  _creationTime: v.number(),
  name: v.string(),
  channel: v.optional(campaignChannelValidator),
  status: campaignStatusValidator,
  totalCount: v.number(),
  sentCount: v.number(),
  failedCount: v.number(),
});

const summaryOf = (campaign: Doc<'campaigns'>) => ({
  _id: campaign._id,
  _creationTime: campaign._creationTime,
  name: campaign.name,
  channel: campaign.channel,
  status: campaign.status,
  totalCount: campaign.totalCount,
  sentCount: campaign.sentCount,
  failedCount: campaign.failedCount,
});

/** The campaigns newest first, a page at a time and without their content: a typed name goes through the search index, a status through its index. Deleted ones are dropped per page, which may run short. */
export const listCampaigns = employeeQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(campaignStatusValidator),
    search: v.optional(v.string()),
  },
  returns: paginationResultValidator(campaignSummaryValidator),
  handler: async (ctx, args) => {
    const term = args.search?.trim() ?? '';
    const status = args.status;
    const result = term
      ? await ctx.db
          .query('campaigns')
          .withSearchIndex('by_name', (q) => {
            const search = q.search('name', term);
            return status ? search.eq('status', status) : search;
          })
          .paginate(args.paginationOpts)
      : status
        ? await ctx.db
            .query('campaigns')
            .withIndex('by_status', (q) => q.eq('status', status))
            .order('desc')
            .paginate(args.paginationOpts)
        : await ctx.db.query('campaigns').order('desc').paginate(args.paginationOpts);
    return { ...result, page: result.page.filter(isNotDeleted).map(summaryOf) };
  },
});

const optionOf = (campaign: Doc<'campaigns'>) => ({
  _id: campaign._id,
  name: campaign.name,
  channel: campaign.channel,
});

/** Ten campaigns to choose from, among the twenty most recent or the twenty best matches of a typed name, on one channel when asked; the one already chosen stays listed, found by its id. */
export const searchCampaigns = employeeQuery({
  args: {
    search: v.optional(v.string()),
    channel: v.optional(campaignChannelValidator),
    selected: v.optional(v.id('campaigns')),
  },
  returns: v.array(
    v.object({
      _id: v.id('campaigns'),
      name: v.string(),
      channel: v.optional(campaignChannelValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const term = args.search?.trim() ?? '';
    const rows = term
      ? await ctx.db
          .query('campaigns')
          .withSearchIndex('by_name', (q) => q.search('name', term))
          .take(20)
      : await ctx.db.query('campaigns').order('desc').take(20);
    const options = rows
      .filter(isNotDeleted)
      .filter((c) => !args.channel || (c.channel ?? 'email') === args.channel)
      .slice(0, 10)
      .map(optionOf);
    const selected = args.selected ? await ctx.db.get(args.selected) : null;
    if (selected && isNotDeleted(selected) && !options.some((o) => o._id === selected._id)) {
      options.unshift(optionOf(selected));
    }
    return options;
  },
});

/** Renders with the helpers of the send path so the preview cannot drift from what was sent; a Brevo template keeps its HTML at Brevo, only its id is known. */
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

/** The campaign and its counters, nothing per send: the sends and the events come by pages. A campaign older than the counters has zeros until the backfill ran. */
export const getCampaign = employeeQuery({
  args: { campaignId: v.id('campaigns') },
  returns: v.union(
    v.object({
      campaign: docOf('campaigns'),
      stats: campaignStatsValidator,
      messagePreview: v.union(
        v.object({ channel: v.literal('sms'), sms: v.optional(v.string()) }),
        v.object({ channel: v.literal('email'), templateId: v.number() }),
        v.object({
          channel: v.literal('email'),
          subject: v.optional(v.string()),
          html: v.optional(v.string()),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || !isNotDeleted(campaign)) return null;
    // The message "as authored" — placeholders left visible (empty params).
    const messagePreview = buildMessagePreview(campaign, {});
    return { campaign, stats: campaign.stats ?? emptyStats(), messagePreview };
  },
});

/** The recipients of a campaign in the order they were prepared, a page at a time. */
export const listCampaignSends = employeeQuery({
  args: { campaignId: v.id('campaigns'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(docOf('campaignSends')),
  handler: async (ctx, args) =>
    ctx.db
      .query('campaignSends')
      .withIndex('by_campaign', (q) => q.eq('campaignId', args.campaignId))
      .paginate(args.paginationOpts),
});

/** Who a send reached, as the tables show it: the name from the merge values, else the address. */
function recipientOf(send: Doc<'campaignSends'> | null): { name: string; contact: string } {
  if (!send) return { name: '', contact: '' };
  const name = `${send.params.firstName ?? ''} ${send.params.lastName ?? ''}`.trim();
  return { name, contact: send.email ?? send.phone ?? '' };
}

/** Paginated natively, unlike the leads table: the index serves the whole query with no in-memory filtering, so a page never hides matches. Each event carries its recipient, read once per send of the page. */
export const listCampaignEvents = employeeQuery({
  args: { campaignId: v.id('campaigns'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      ...docOf('campaignEvents').fields,
      recipient: v.object({ name: v.string(), contact: v.string() }),
    }),
  ),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('campaignEvents')
      .withIndex('by_campaign_eventAt', (q) => q.eq('campaignId', args.campaignId))
      .order('desc')
      .paginate(args.paginationOpts);
    const sends = new Map<Id<'campaignSends'>, Doc<'campaignSends'> | null>();
    const page = [];
    for (const event of result.page) {
      if (!sends.has(event.sendId)) sends.set(event.sendId, await ctx.db.get(event.sendId));
      page.push({ ...event, recipient: recipientOf(sends.get(event.sendId) ?? null) });
    }
    return { ...result, page };
  },
});

/** What one recipient received, fetched when its preview drawer opens so that nothing is rendered for every send up front. */
export const getCampaignSendPreview = employeeQuery({
  args: { sendId: v.id('campaignSends') },
  returns: v.union(
    v.object({
      channel: v.literal('sms'),
      sms: v.optional(v.string()),
      leadName: v.union(v.string(), v.null()),
      contact: v.union(v.string(), v.null()),
      status: campaignSendStatusValidator,
      sentAt: v.optional(v.number()),
      openedAt: v.optional(v.number()),
      clickedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      params: v.record(v.string(), v.string()),
      events: v.array(docOf('campaignEvents')),
    }),
    v.object({
      channel: v.literal('email'),
      templateId: v.number(),
      leadName: v.union(v.string(), v.null()),
      contact: v.union(v.string(), v.null()),
      status: campaignSendStatusValidator,
      sentAt: v.optional(v.number()),
      openedAt: v.optional(v.number()),
      clickedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      params: v.record(v.string(), v.string()),
      events: v.array(docOf('campaignEvents')),
    }),
    v.object({
      channel: v.literal('email'),
      subject: v.optional(v.string()),
      html: v.optional(v.string()),
      leadName: v.union(v.string(), v.null()),
      contact: v.union(v.string(), v.null()),
      status: campaignSendStatusValidator,
      sentAt: v.optional(v.number()),
      openedAt: v.optional(v.number()),
      clickedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      params: v.record(v.string(), v.string()),
      events: v.array(docOf('campaignEvents')),
    }),
    v.null(),
  ),
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
