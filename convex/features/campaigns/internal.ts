import { v } from 'convex/values';
import { loadLifecycleConfig } from '../../lib/leads/lifecycle';
import { internalQuery, type MutationCtx } from '../../_generated/server';
import { internalMutation } from '../../_lib/functions';
import { computeChanges, logAudit } from '../../lib/audit/log';
import { toBrevoRecipient } from '../../lib/sms/brevo';
import { campaignSendStatusValidator, campaignEventTypeValidator } from '../../schema';
import type {
  CampaignEvent,
  CampaignEventType,
  WorkflowEmailEvent,
  WorkflowSmsEvent,
} from '../../schema';
import { buildLeadTargetPatch } from '../../lib/leads/targets';
import { dispatchWorkflowTrigger } from '../../lib/workflows/dispatch';
import { diffLeadFilterFields } from '../../lib/workflows/rules';
import { internal } from '../../_generated/api';
import { appOrigin } from '../../lib/config/appUrl';
import { buildSendParams } from './mutations';
import { loadPropertyDefsById } from '../../lib/properties/definitions';
import { loadVisibility, scopedReader } from '../../lib/roles/visibility';
import {
  BEHAVIOURAL_CAMPAIGN_EVENTS,
  profilingExcluded,
  stampLeadSignal,
} from '../../lib/leads/signals';
import { LINK_GRANT_MS } from '../../_lib/validators/tracking';
import { loadTrackingConfig, namedTracking, onAllowedSite } from '../../lib/tracking/config';
import {
  leadFilterArgs,
  loadAdvancedListMembers,
  loadListMemberIdsForLeads,
  matchesLeadFilters,
} from '../../lib/leads/tableFilters';
import { deferUnlessAllowed, trySend } from '../../lib/extensions/gates';

const BATCH_SIZE = 50;

/** Load the campaign template id plus the next batch of pending sends. */
export const getPendingSends = internalQuery({
  args: { campaignId: v.id('campaigns') },
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
  },
});

/** Campaign event → workflow trigger event, per channel. Unmapped types don't trigger. */
const EMAIL_TRIGGER_EVENT: Partial<Record<CampaignEventType, WorkflowEmailEvent>> = {
  delivered: 'delivered',
  opened: 'opened',
  clicked: 'clicked',
  hard_bounce: 'hard_bounce',
  soft_bounce: 'soft_bounce',
  unsubscribed: 'unsubscribed',
};
const SMS_TRIGGER_EVENT: Partial<Record<CampaignEventType, WorkflowSmsEvent>> = {
  delivered: 'delivered',
  sms_reply: 'sms_reply',
  unsubscribed: 'stop',
};

/** Brevo retries a webhook with the same event timestamp, so an identical `(type, eventAt)` is a replay and is dropped; workflow triggers fire from here only, and inherit that dedup. */
async function insertCampaignEventIfNew(
  ctx: MutationCtx,
  event: CampaignEvent,
): Promise<'recorded' | 'duplicate' | 'excluded'> {
  // The single gate for behavioural events: a contact who objected to profiling gets no row, no signal, no trigger.
  if (
    BEHAVIOURAL_CAMPAIGN_EVENTS.has(event.type) &&
    profilingExcluded(await ctx.db.get(event.leadId))
  ) {
    return 'excluded';
  }
  // A send has tens of events at most.
  const existing = await ctx.db
    .query('campaignEvents')
    .withIndex('by_send', (q) => q.eq('sendId', event.sendId))
    .collect();
  if (existing.some((e) => e.type === event.type && e.eventAt === event.eventAt)) {
    return 'duplicate';
  }
  await ctx.db.insert('campaignEvents', event);

  if (event.type === 'opened') {
    await stampLeadSignal(ctx, event.leadId, 'email_open', event.eventAt);
  } else if (event.type === 'clicked' || event.type === 'link_click') {
    await stampLeadSignal(ctx, event.leadId, 'email_click', event.eventAt);
  } else if (event.type === 'sms_reply') {
    await stampLeadSignal(ctx, event.leadId, 'activity', event.eventAt);
  }

  const campaign = await ctx.db.get(event.campaignId);
  const channel = campaign?.channel ?? 'email';
  if (channel === 'sms') {
    const smsEvent = SMS_TRIGGER_EVENT[event.type];
    if (smsEvent) {
      await dispatchWorkflowTrigger(ctx, event.leadId, {
        type: 'campaign_sms_event',
        event: smsEvent,
        campaignId: event.campaignId,
      });
    }
  } else {
    const emailEvent = EMAIL_TRIGGER_EVENT[event.type];
    if (emailEvent) {
      await dispatchWorkflowTrigger(ctx, event.leadId, {
        type: 'campaign_email_event',
        event: emailEvent,
        campaignId: event.campaignId,
      });
    }
  }
  return 'recorded';
}

/** A Brevo email webhook event is tied to its send by `brevoMessageId`; the send's `openedAt` and `clickedAt` are first-only. */
export const recordBrevoEmailEvent = internalMutation({
  args: {
    brevoMessageId: v.string(),
    type: campaignEventTypeValidator,
    eventAt: v.number(),
    url: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const send = await ctx.db
      .query('campaignSends')
      .withIndex('by_brevoMessageId', (q) => q.eq('brevoMessageId', args.brevoMessageId))
      .first();
    if (!send) {
      // Dev-whitelist skips and non-campaign transactional mail land here.
      console.warn('Brevo email webhook: no campaignSend for messageId', args.brevoMessageId);
      return;
    }

    const outcome = await insertCampaignEventIfNew(ctx, {
      campaignId: send.campaignId,
      sendId: send._id,
      leadId: send.leadId,
      type: args.type,
      eventAt: args.eventAt,
      url: args.url,
      reason: args.reason,
    });
    // An objection leaves the send unstamped too: nothing says the person opened or clicked.
    if (outcome === 'excluded') return;

    if (args.type === 'opened' && send.openedAt === undefined) {
      await ctx.db.patch(send._id, { openedAt: args.eventAt });
    }
    if (args.type === 'clicked' && send.clickedAt === undefined) {
      await ctx.db.patch(send._id, { clickedAt: args.eventAt });
    }
  },
});

/** Brevo SMS webhook `msg_status` values worth logging as campaign events. */
const SMS_EVENT_TYPE: Record<string, CampaignEventType> = {
  delivered: 'delivered',
  replied: 'sms_reply',
  unsubscribed: 'unsubscribed',
  bl: 'blocked',
  hard_bounce: 'hard_bounce',
  soft_bounce: 'soft_bounce',
};

/** Brevo SMS `msg_status` → the first-only lifecycle marker it stamps on the send. */
const SMS_STATUS_MARKER: Record<
  string,
  'deliveredAt' | 'repliedAt' | 'unsubscribedAt' | 'bouncedAt'
> = {
  delivered: 'deliveredAt',
  replied: 'repliedAt',
  unsubscribed: 'unsubscribedAt',
  bl: 'unsubscribedAt',
  hard_bounce: 'bouncedAt',
  soft_bounce: 'bouncedAt',
};

/** A STOP (`unsubscribed`, or `bl` for blacklisted) revokes the lead's SMS consent; a replay changes nothing, it finds the marker and the consent already set. */
export const handleSmsEvent = internalMutation({
  args: {
    brevoMessageId: v.optional(v.string()),
    // Present on inbound events, and matched against campaignSends.smsRecipient once stripped to digits.
    recipient: v.optional(v.string()),
    msgStatus: v.string(),
    eventAt: v.number(),
  },
  handler: async (ctx, args) => {
    const type = SMS_EVENT_TYPE[args.msgStatus];
    if (!type) return;

    // The message id first, it is precise; the phone as a fallback, as a STOP arrives with a fresh id that matches no send but always carries the recipient.
    let send = args.brevoMessageId
      ? await ctx.db
          .query('campaignSends')
          .withIndex('by_brevoMessageId', (q) => q.eq('brevoMessageId', args.brevoMessageId))
          .first()
      : null;
    const recipientDigits = args.recipient?.replace(/\D/g, '');
    if (!send && recipientDigits) {
      send = await ctx.db
        .query('campaignSends')
        .withIndex('by_smsRecipient', (q) => q.eq('smsRecipient', recipientDigits))
        .first();
    }
    if (!send) {
      console.warn(
        'SMS webhook: no campaignSend for',
        args.recipient ? `recipient ${args.recipient}` : `messageId ${args.brevoMessageId}`,
      );
      return;
    }

    await insertCampaignEventIfNew(ctx, {
      campaignId: send.campaignId,
      sendId: send._id,
      leadId: send.leadId,
      type,
      eventAt: args.eventAt,
    });

    // First-only lifecycle marker on the send, powering the SMS campaign metrics.
    const marker = SMS_STATUS_MARKER[args.msgStatus];
    if (marker && send[marker] === undefined) {
      await ctx.db.patch(send._id, { [marker]: args.eventAt });
    }

    if (args.msgStatus !== 'unsubscribed' && args.msgStatus !== 'bl') return;

    const lead = await ctx.db.get(send.leadId);
    if (!lead || lead.deletedAt !== undefined) return;
    if (!lead.marketingConsent.includes('sms')) return;

    const marketingConsent = lead.marketingConsent.filter((channel) => channel !== 'sms');
    await ctx.db.patch(lead._id, {
      marketingConsent,
      consentUpdatedAt: Date.now(),
      consentSource: 'sms_stop',
      updatedAt: Date.now(),
    });
    await logAudit({
      ctx,
      entityType: 'lead',
      entityId: lead._id,
      action: 'update',
      metadata: { source: 'sms_stop', changes: computeChanges(lead, { marketingConsent }) },
    });

    // System note (no createdBy) so the opt-out is visible in the lead timeline.
    await ctx.db.insert('leadNotes', {
      leadId: lead._id,
      content: 'Désinscription SMS : le contact a répondu STOP (événement Brevo).',
      isPinned: false,
      updatedAt: Date.now(),
    });

    await dispatchWorkflowTrigger(ctx, lead._id, { type: 'consent_updated' });
  },
});

// Each recipient writes one campaignSends row plus one campaignLinkTokens row per tracked link: 200 leads stay far below Convex's 8,192 writes per transaction.
const PREP_BATCH = 200;

export const prepareCampaignBatch = internalMutation({
  args: {
    campaignId: v.id('campaigns'),
    filter: v.object(leadFilterArgs),
    cursor: v.optional(v.string()),
    // Tests only: a small page exercises the per-page gate; production keeps PREP_BATCH.
    batchSize: v.optional(v.number()),
  },
  // The paging state is returned so tests can drive the chain without the scheduler; production runs on the self-scheduled chain below.
  handler: async (ctx, args): Promise<{ isDone: boolean; continueCursor: string | null }> => {
    const campaign = await ctx.db.get(args.campaignId);
    // Deleted mid-preparation (or unexpected state): stop the chain quietly.
    if (!campaign || campaign.deletedAt != null || campaign.status !== 'preparing') {
      return { isDone: true, continueCursor: null };
    }
    // Deferred (e.g. a suspended deployment): the same page runs again later, nothing changes.
    if (
      await deferUnlessAllowed(
        ctx,
        'campaign_prepare',
        internal.features.campaigns.internal.prepareCampaignBatch,
        args,
      )
    ) {
      return { isDone: false, continueCursor: args.cursor ?? null };
    }

    const isSms = campaign.channel === 'sms';
    const trackedLinks = campaign.trackedLinks ?? [];
    const defsById = await loadPropertyDefsById(ctx, 'lead');
    const consentBase = appOrigin() || 'http://localhost:4202';
    const linkBase = process.env.CONVEX_SITE_URL;
    const lifecycle = await loadLifecycleConfig(ctx);
    const creator = campaign.createdBy ? await ctx.db.get(campaign.createdBy) : null;
    const leadsDb = creator ? scopedReader(ctx, await loadVisibility(ctx, creator)) : ctx.db;
    const page = await leadsDb
      .query('leads')
      .paginate({ cursor: args.cursor ?? null, numItems: args.batchSize ?? PREP_BATCH });

    // List membership is resolved per page with indexed point reads: loading the full member set (loadListMemberIds) is unbounded on large lists.
    const pageIds = page.page.map((lead) => lead._id);
    const listMemberIds = await loadListMemberIdsForLeads(ctx, args.filter.listIds, pageIds);
    const advancedListMembers = await loadAdvancedListMembers(
      ctx,
      args.filter.advancedFilter,
      pageIds,
    );

    let total = 0;
    let skipped = 0;
    for (const lead of page.page) {
      if (!matchesLeadFilters(lead, { ...args.filter, listMemberIds, advancedListMembers }))
        continue;
      total++;

      // Token rows are inserted only for sends that go out (a skipped recipient gets dead URLs), but params and tokens are built as on a resend.
      const { params, tokens: leadTokens } = buildSendParams(lead, {
        trackedLinks,
        defsById,
        consentBase,
        linkBase,
        lifecycle,
      });

      const contact = isSms ? lead.phone : lead.email;
      if (!contact) {
        await ctx.db.insert('campaignSends', {
          campaignId: args.campaignId,
          leadId: lead._id,
          params,
          status: isSms ? 'skipped_no_phone' : 'skipped_no_email',
        });
        skipped++;
        continue;
      }

      const sendId = await ctx.db.insert('campaignSends', {
        campaignId: args.campaignId,
        leadId: lead._id,
        email: isSms ? undefined : lead.email,
        phone: isSms ? lead.phone : undefined,
        // Normalized recipient so an inbound STOP webhook can be matched by phone.
        smsRecipient: isSms ? (toBrevoRecipient(lead.phone) ?? undefined) : undefined,
        params,
        status: 'pending',
      });
      for (const { linkKey, token } of leadTokens) {
        await ctx.db.insert('campaignLinkTokens', {
          token,
          campaignId: args.campaignId,
          sendId,
          leadId: lead._id,
          linkKey,
        });
      }
    }

    const totalCount = campaign.totalCount + total;
    const failedCount = campaign.failedCount + skipped;
    const pending = totalCount - failedCount;

    // Gated on every page with the running count: a refused campaign stops within one page of the limit.
    const refused =
      pending > 0
        ? await trySend(ctx, {
            source: 'campaign',
            channel: campaign.channel ?? 'email',
            count: pending,
            stage: page.isDone ? 'prepared' : 'preparing',
          })
        : null;
    if (refused) {
      await ctx.db.patch(args.campaignId, {
        totalCount,
        failedCount,
        status: 'failed',
        failureReason: refused,
      });
      return { isDone: true, continueCursor: page.continueCursor };
    }

    if (!page.isDone) {
      await ctx.db.patch(args.campaignId, { totalCount, failedCount });
      await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.prepareCampaignBatch, {
        campaignId: args.campaignId,
        filter: args.filter,
        cursor: page.continueCursor,
        batchSize: args.batchSize,
      });
      return { isDone: false, continueCursor: page.continueCursor };
    }

    // Last page: a pending send, from this batch or an earlier one, means there is something to deliver.
    const hasPending = pending > 0;
    await ctx.db.patch(args.campaignId, {
      totalCount,
      failedCount,
      status: hasPending ? 'sending' : 'sent',
    });
    if (hasPending) {
      await ctx.scheduler.runAfter(0, internal.features.campaigns.actions.sendCampaignBatch, {
        campaignId: args.campaignId,
      });
    }
    return { isDone: true, continueCursor: page.continueCursor };
  },
});
/** Behind the public GET /l/<token> route, so no authenticated user: a repeated click re-applies the same value and adds an event, and a system note records the first click. */
export const handleTrackedLinkClick = internalMutation({
  // `grantHash`: the hash of the one-time value the route may put in the landing URL (named tracking).
  args: { token: v.string(), grantHash: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ found: boolean; redirectUrl?: string; identify?: boolean }> => {
    const tokenRow = await ctx.db
      .query('campaignLinkTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
    if (!tokenRow) return { found: false };

    const campaign = await ctx.db.get(tokenRow.campaignId);
    const link = campaign?.trackedLinks?.find((l) => l.key === tokenRow.linkKey);
    // The person objected to profiling: the link still leads where it should, and nothing is written down.
    if (profilingExcluded(await ctx.db.get(tokenRow.leadId))) {
      return { found: true, redirectUrl: link?.redirectUrl, identify: false };
    }

    const now = Date.now();
    const firstClick = tokenRow.clickedAt === undefined;
    if (firstClick) await ctx.db.patch(tokenRow._id, { clickedAt: now });

    const send = await ctx.db.get(tokenRow.sendId);
    if (send && send.clickedAt === undefined) {
      await ctx.db.patch(tokenRow.sendId, { clickedAt: now });
    }

    // Event log: every click is recorded, unlike the first-only stamps above.
    await ctx.db.insert('campaignEvents', {
      campaignId: tokenRow.campaignId,
      sendId: tokenRow.sendId,
      leadId: tokenRow.leadId,
      type: 'link_click',
      eventAt: now,
      linkKey: tokenRow.linkKey,
      linkLabel: link?.label,
    });

    await dispatchWorkflowTrigger(ctx, tokenRow.leadId, {
      type: 'tracked_link_click',
      campaignId: tokenRow.campaignId,
      linkKey: tokenRow.linkKey,
    });

    // The redirect still happens when the lead or a custom-property definition disappeared since the campaign was sent.
    const lead = await ctx.db.get(tokenRow.leadId);
    if (link && lead && lead.deletedAt === undefined) {
      const patch = await buildLeadTargetPatch(ctx, lead, link.target, link.value);
      if (patch) {
        const changedFields = diffLeadFilterFields(lead, patch);
        await ctx.db.patch(lead._id, { ...patch, updatedAt: now });
        const changes = computeChanges(lead, patch);
        if (changes) {
          await logAudit({
            ctx,
            entityType: 'lead',
            entityId: lead._id,
            action: 'update',
            metadata: { source: 'tracked_link', campaignId: tokenRow.campaignId, changes },
          });
        }
        if (changedFields.length > 0) {
          await dispatchWorkflowTrigger(ctx, lead._id, {
            type: 'lead_property_changed',
            changedFields,
          });
        }
        if (firstClick) {
          // System note (no createdBy), mirroring the SMS opt-out timeline entry.
          await ctx.db.insert('leadNotes', {
            leadId: lead._id,
            content: `Lien cliqué : ${link.label} (campagne « ${campaign?.name} »).`,
            isPinned: false,
            updatedAt: now,
          });
        }
      }
    }

    // Named tracking, a link that lands on a tracked site: the click may identify the browser, once and for a short while.
    const tracking = await loadTrackingConfig(ctx);
    const identify =
      args.grantHash !== undefined &&
      namedTracking(tracking) &&
      onAllowedSite(tracking, link?.redirectUrl);
    if (identify) {
      await ctx.db.patch(tokenRow._id, {
        identifyHash: args.grantHash,
        identifyUntil: now + LINK_GRANT_MS,
      });
    }
    return { found: true, redirectUrl: link?.redirectUrl, identify };
  },
});

/** Finalize a campaign once no pending sends remain. */
export const markCampaignComplete = internalMutation({
  args: { campaignId: v.id('campaigns') },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return;
    await ctx.db.patch(args.campaignId, {
      status: campaign.sentCount > 0 ? 'sent' : 'failed',
      updatedAt: Date.now(),
    });
  },
});

/** When the send path cannot proceed (no usable provider, a fatal error mid-drain): the pending sends are failed so they show in the UI and can be retried. */
export const failPendingSends = internalMutation({
  args: { campaignId: v.id('campaigns'), error: v.string() },
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
