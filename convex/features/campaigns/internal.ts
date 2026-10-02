import { campaignChannelValidator } from '../../_lib/validators/crm';
import { messageTypeValidator } from '../../_lib/validators/crm';
import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { internalMutation } from '../../_lib/functions';
import { campaignEventTypeValidator, campaignSendStatusValidator } from '../../_lib/validators/crm';
import { recordEmailEvent, recordSmsEvent } from '../../lib/campaigns/events';
import { clickTrackedLink } from '../../lib/campaigns/links';
import { prepareBatch } from '../../lib/campaigns/prepare';
import { stampLeadSignal } from '../../lib/leads/signals';
import { leadFilterArgs } from '../../lib/leads/tableFilters';

const BATCH_SIZE = 50;

/** Load the campaign template id plus the next batch of pending sends. */
export const getPendingSends = internalQuery({
  args: { campaignId: v.id('campaigns') },
  returns: v.union(
    v.object({
      channel: v.optional(campaignChannelValidator),
      brevoTemplateId: v.optional(v.number()),
      subject: v.optional(v.string()),
      htmlBody: v.optional(v.string()),
      smsBody: v.optional(v.string()),
      messageType: v.optional(messageTypeValidator),
      sends: v.array(
        v.object({
          sendId: v.id('campaignSends'),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
          params: v.record(v.string(), v.string()),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;

    const pending = await ctx.db
      .query('campaignSends')
      .withIndex('by_campaign_status', (q) =>
        q.eq('campaignId', args.campaignId).eq('status', 'pending'),
      )
      .take(BATCH_SIZE);

    return {
      channel: campaign.channel,
      brevoTemplateId: campaign.brevoTemplateId,
      subject: campaign.subject,
      htmlBody: campaign.htmlBody,
      smsBody: campaign.smsBody,
      messageType: campaign.messageType,
      sends: pending.map((send) => ({
        sendId: send._id,
        email: send.email,
        phone: send.phone,
        params: send.params,
      })),
    };
  },
});

/** Record the outcome of a batch of sends and bump the campaign counters. */
export const recordSendResults = internalMutation({
  args: {
    campaignId: v.id('campaigns'),
    results: v.array(
      v.object({
        sendId: v.id('campaignSends'),
        status: campaignSendStatusValidator,
        brevoMessageId: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let sentDelta = 0;
    let failedDelta = 0;

    for (const result of args.results) {
      await ctx.db.patch(result.sendId, {
        status: result.status,
        brevoMessageId: result.brevoMessageId,
        error: result.error,
        sentAt: Date.now(),
      });
      if (result.status === 'sent') {
        sentDelta++;
        const send = await ctx.db.get(result.sendId);
        if (send) await stampLeadSignal(ctx, send.leadId, 'activity', Date.now());
      } else failedDelta++;
    }

    const campaign = await ctx.db.get(args.campaignId);
    if (campaign) {
      await ctx.db.patch(args.campaignId, {
        sentCount: campaign.sentCount + sentDelta,
        failedCount: campaign.failedCount + failedDelta,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** A Brevo email webhook event, tied to its send by `brevoMessageId`. */
export const recordBrevoEmailEvent = internalMutation({
  args: {
    brevoMessageId: v.string(),
    type: campaignEventTypeValidator,
    eventAt: v.number(),
    url: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordEmailEvent(ctx, args);
    return null;
  },
});

/** A Brevo SMS webhook event; a STOP revokes the lead's SMS consent. */
export const handleSmsEvent = internalMutation({
  args: {
    brevoMessageId: v.optional(v.string()),
    // Present on inbound events, and matched against campaignSends.smsRecipient once stripped to digits.
    recipient: v.optional(v.string()),
    msgStatus: v.string(),
    eventAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordSmsEvent(ctx, args);
    return null;
  },
});

/** One page of the recipients of a campaign, as sends; it schedules the next page, then the drain. */
export const prepareCampaignBatch = internalMutation({
  args: {
    campaignId: v.id('campaigns'),
    filter: v.object(leadFilterArgs),
    cursor: v.optional(v.string()),
    // Tests only: a small page exercises the per-page gate; production keeps the batch of lib/campaigns/prepare.ts.
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ isDone: v.boolean(), continueCursor: v.union(v.string(), v.null()) }),
  handler: (ctx, args) => prepareBatch(ctx, args),
});

/** Behind the public GET /l/<token> route, so no authenticated user. */
export const handleTrackedLinkClick = internalMutation({
  // `grantHash`: the hash of the one-time value the route may put in the landing URL (named tracking).
  args: { token: v.string(), grantHash: v.optional(v.string()) },
  returns: v.object({
    found: v.boolean(),
    redirectUrl: v.optional(v.string()),
    identify: v.optional(v.boolean()),
  }),
  handler: (ctx, args) => clickTrackedLink(ctx, args),
});

/** Finalize a campaign once no pending sends remain. */
export const markCampaignComplete = internalMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    await ctx.db.patch(args.campaignId, {
      status: campaign.sentCount > 0 ? 'sent' : 'failed',
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** When the send path cannot proceed (no usable provider, a fatal error mid-drain): the pending sends are failed so they show in the UI and can be retried. */
export const failPendingSends = internalMutation({
  args: { campaignId: v.id('campaigns'), error: v.string() },
  returns: v.object({ failed: v.number() }),
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query('campaignSends')
      .withIndex('by_campaign_status', (q) =>
        q.eq('campaignId', args.campaignId).eq('status', 'pending'),
      )
      .collect();
    if (pending.length === 0) return { failed: 0 };

    for (const send of pending) {
      await ctx.db.patch(send._id, { status: 'failed', error: args.error });
    }
    const campaign = await ctx.db.get(args.campaignId);
    if (campaign) {
      await ctx.db.patch(args.campaignId, {
        failedCount: campaign.failedCount + pending.length,
        updatedAt: Date.now(),
      });
    }
    return { failed: pending.length };
  },
});
