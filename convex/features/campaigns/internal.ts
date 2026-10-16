import { campaignChannelValidator } from '../../_lib/validators/crm';
import { messageTypeValidator } from '../../_lib/validators/crm';
import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { internalQuery, type MutationCtx } from '../../_generated/server';
import { internalMutation } from '../../_lib/functions';
import { refusal } from '../../_lib/refusal';
import {
  campaignAbTestValidator,
  campaignEventTypeValidator,
  campaignSendStatusValidator,
  campaignVariantValidator,
} from '../../_lib/validators/crm';
import { recordEmailEvent, recordSmsEvent } from '../../lib/campaigns/events';
import { clickTrackedLink } from '../../lib/campaigns/links';
import { prepareBatch } from '../../lib/campaigns/prepare';
import { resendBatch } from '../../lib/campaigns/resend';
import { restartStuckDrains as restartDrains, scheduleDrain } from '../../lib/campaigns/drain';
import { startCampaign, startRefusal } from '../../lib/campaigns/schedule';
import { cancelPendingSends as cancelPending } from '../../lib/campaigns/stop';
import { countStatsPage, readCampaignStats, startStatsCount } from '../../lib/campaigns/stats';
import { pickWinner } from '../../lib/campaigns/variants';
import { logAudit } from '../../lib/audit/log';
import { stampLeadSignal } from '../../lib/leads/signals';
import { leadFilterArgs } from '../../lib/leads/tableFilters';

const BATCH_SIZE = 50;
// Failing a send is one patch: 200 per transaction keeps the chain short and far below the write limit.
const FAIL_BATCH = 200;

/** The message of the campaign plus the next batch of its pending sends that are due; with none due, when the next one is. A holdout send due before the test is decided asks for the decision first. */
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
      abTest: v.optional(campaignAbTestValidator),
      winnerPending: v.boolean(),
      nextAt: v.optional(v.number()),
      sends: v.array(
        v.object({
          sendId: v.id('campaignSends'),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
          params: v.record(v.string(), v.string()),
          variant: v.optional(campaignVariantValidator),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    // Stopped meanwhile: nothing more leaves, and the drain ends.
    if (campaign?.status !== 'sending') return null;

    const now = Date.now();
    // A send without a time sorts before every time: it is due.
    const due = await ctx.db
      .query('campaignSends')
      .withIndex('by_campaign_status_sendAt', (q) =>
        q.eq('campaignId', args.campaignId).eq('status', 'pending').lte('sendAt', now),
      )
      .take(BATCH_SIZE);
    const next =
      due.length === 0
        ? await ctx.db
            .query('campaignSends')
            .withIndex('by_campaign_status_sendAt', (q) =>
              q.eq('campaignId', args.campaignId).eq('status', 'pending').gt('sendAt', now),
            )
            .first()
        : null;
    const test = campaign.abTest;
    const winnerPending = !!test && !test.winner && due.some((send) => send.variant === undefined);

    return {
      channel: campaign.channel,
      brevoTemplateId: campaign.brevoTemplateId,
      subject: campaign.subject,
      htmlBody: campaign.htmlBody,
      smsBody: campaign.smsBody,
      messageType: campaign.messageType,
      abTest: test,
      winnerPending,
      nextAt: next?.sendAt,
      sends: due.map((send) => ({
        sendId: send._id,
        email: send.email,
        phone: send.phone,
        params: send.params,
        variant: send.variant,
      })),
    };
  },
});

/** The scheduled call: the campaign starts if it still waits; cancelled or started by hand meanwhile, nothing happens. What the creation checked is checked again: refused, the campaign goes back to draft with the code, for someone to see. */
export const startScheduledCampaign = internalMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.deletedAt != null || campaign.status !== 'scheduled') return null;
    const refused = await startRefusal(ctx, campaign);
    if (refused) {
      await ctx.db.patch(args.campaignId, {
        status: 'draft',
        scheduledAt: undefined,
        scheduledFnId: undefined,
        failureReason: refused,
        updatedAt: Date.now(),
      });
      await logAudit({
        ctx,
        userId: undefined,
        entityType: 'campaign',
        entityId: args.campaignId,
        action: 'update',
        metadata: { event: 'start_refused', code: refused },
      });
      return null;
    }
    await startCampaign(ctx, campaign);
    return null;
  },
});

/** The drain's next call, from the action: scheduled and kept on the campaign in one transaction. */
export const scheduleCampaignDrain = internalMutation({
  args: { campaignId: v.id('campaigns'), at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await scheduleDrain(ctx, args.campaignId, args.at);
    return null;
  },
});

/** Hourly: the campaigns being sent whose chain broke are drained again. */
export const restartStuckDrains = internalMutation({
  args: {},
  returns: v.array(v.id('campaigns')),
  handler: async (ctx) => await restartDrains(ctx),
});

/** One page of the pending sends of a stopped campaign cancelled; it schedules the next. */
export const cancelPendingSends = internalMutation({
  args: {
    campaignId: v.id('campaigns'),
    // Tests only: a small page exercises the chain.
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ cancelled: v.number(), isDone: v.boolean() }),
  handler: (ctx, args) => cancelPending(ctx, args),
});

/** The winner of the test, from the counters of its variants, once; the holdout then receives it. */
export const decideAbWinner = internalMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.union(campaignVariantValidator, v.null()),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    const test = campaign?.abTest;
    if (!campaign || !test) return null;
    if (test.winner) return test.winner;
    const stats = await readCampaignStats(ctx, args.campaignId);
    const { winner, decidedBy } = pickWinner(stats, test.metric);
    await ctx.db.patch(args.campaignId, {
      abTest: { ...test, winner, decidedAt: Date.now(), decidedBy },
      updatedAt: Date.now(),
    });
    // The figures of the moment, so the entry tells a result from a default.
    await logAudit({
      ctx,
      userId: undefined,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: 'ab_winner', winner, decidedBy, metric: test.metric, ...stats.variants },
    });
    return winner;
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
    reply: v.optional(v.string()),
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

/** One page of the sends of a campaign re-queued for a resend; it schedules the next page, then the drain. */
export const resendCampaignBatch = internalMutation({
  args: {
    campaignId: v.id('campaigns'),
    cursor: v.optional(v.string()),
    // Sends re-queued by the pages before, so the last one knows whether there is anything to drain.
    resent: v.optional(v.number()),
    // A resume: the cancelled sends only; « Relancer les échecs »: the failed ones only.
    only: v.optional(v.union(v.literal('cancelled'), v.literal('failed'))),
    // Tests only: a small page exercises the chain; production keeps the batch of lib/campaigns/resend.ts.
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ isDone: v.boolean(), continueCursor: v.union(v.string(), v.null()) }),
  handler: (ctx, args) => resendBatch(ctx, args),
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

/** A campaign with no pending send left ends sent when something left, failed otherwise; one stopped meanwhile keeps its word. */
async function completeCampaign(ctx: MutationCtx, campaignId: Id<'campaigns'>): Promise<void> {
  const campaign = await ctx.db.get(campaignId);
  if (campaign?.status !== 'sending') return;
  await ctx.db.patch(campaignId, {
    status: campaign.sentCount > 0 ? 'sent' : 'failed',
    updatedAt: Date.now(),
  });
}

/** Finalize a campaign once no pending sends remain. */
export const markCampaignComplete = internalMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await completeCampaign(ctx, args.campaignId);
    return null;
  },
});

/** When the send path cannot proceed (no usable provider, a fatal error mid-drain): the pending sends are failed, a batch at a time, so they show in the UI and can be retried; the campaign is completed with the last batch. */
export const failPendingSends = internalMutation({
  args: {
    campaignId: v.id('campaigns'),
    error: v.string(),
    // Tests only: a small batch exercises the chain.
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ failed: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const limit = args.batchSize ?? FAIL_BATCH;
    const pending = await ctx.db
      .query('campaignSends')
      .withIndex('by_campaign_status', (q) =>
        q.eq('campaignId', args.campaignId).eq('status', 'pending'),
      )
      .take(limit);
    for (const send of pending) {
      await ctx.db.patch(send._id, { status: 'failed', error: args.error });
    }
    const campaign = await ctx.db.get(args.campaignId);
    if (campaign && pending.length > 0) {
      await ctx.db.patch(args.campaignId, {
        failedCount: campaign.failedCount + pending.length,
        updatedAt: Date.now(),
      });
    }
    // A full batch may leave more behind: the next one is scheduled, the campaign completes with the last.
    if (pending.length >= limit) {
      await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.failPendingSends, args);
      return { failed: pending.length, isDone: false };
    }
    await completeCampaign(ctx, args.campaignId);
    return { failed: pending.length, isDone: true };
  },
});

/** The counters of one campaign counted again from its sends, for one that looks off: `bunx convex run features/campaigns/internal:recountCampaignStats '{"campaignId":"…"}'`, at any time and as often as wanted. */
export const recountCampaignStats = internalMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.campaignId))) throw refusal('campaign_not_found');
    await startStatsCount(ctx, args.campaignId);
    return null;
  },
});

/** One page of a count; it schedules the next. */
export const countCampaignStatsPage = internalMutation({
  args: {
    campaignId: v.id('campaigns'),
    // Tests only: a small page exercises the chain; production keeps the page of lib/campaigns/stats.ts.
    pageSize: v.optional(v.number()),
  },
  returns: v.object({ isDone: v.boolean() }),
  handler: (ctx, args) => countStatsPage(ctx, args),
});
