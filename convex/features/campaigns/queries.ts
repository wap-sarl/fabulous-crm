import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { employeeQuery } from '../../_lib/auth';
import type { Doc } from '../../_generated/dataModel';
import { isNotDeleted } from '../../_lib/softDelete';
import { renderPlaceholders, wrapEmailHtml } from '../../lib/email/brevo';

export const listCampaigns = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db.query('campaigns').order('desc').collect();
    return campaigns.filter(isNotDeleted);
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

/** Paginated natively, unlike the leads table: the index serves the whole query with no in-memory filtering, so a page never hides matches. */
export const listCampaignEvents = employeeQuery({
  args: { campaignId: v.id('campaigns'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) =>
    ctx.db
      .query('campaignEvents')
      .withIndex('by_campaign_eventAt', (q) => q.eq('campaignId', args.campaignId))
      .order('desc')
      .paginate(args.paginationOpts),
});

/** What one recipient received, fetched when its preview drawer opens so that nothing is rendered for every send up front. */
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
