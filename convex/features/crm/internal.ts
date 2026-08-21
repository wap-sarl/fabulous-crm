import { v } from 'convex/values';
import { internalQuery, internalMutation, type MutationCtx } from '../../_generated/server';
import { toBrevoRecipient } from '../../lib';
import { campaignSendStatusValidator, campaignEventTypeValidator } from '../../schema';
import type {
  CampaignEvent,
  CampaignEventType,
  WorkflowEmailEvent,
  WorkflowSmsEvent,
} from '../../schema';
import { buildLeadTargetPatch } from './leadTargets';
import { dispatchWorkflowTrigger } from '../workflows/triggerDispatch';
import { diffLeadFilterFields } from '../workflows/lib';

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
      if (result.status === 'sent') sentDelta++;
      else failedDelta++;
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

/**
 * Insert a campaignEvents row unless the send already has an identical
 * `(type, eventAt)` one. Brevo retries webhooks on non-2xx responses with the
 * same event timestamp, so replays are no-ops while genuine repeats (new
 * timestamps) are kept. A send's event list stays small (tens of rows).
 *
 * Fresh inserts also fan out to workflow triggers (campaign_email_event /
 * campaign_sms_event) — the single choke point for engagement events, so
 * webhook-replay dedup is inherited by the trigger dispatch for free.
 */
async function insertCampaignEventIfNew(ctx: MutationCtx, event: CampaignEvent): Promise<boolean> {
  const existing = await ctx.db
    .query('campaignEvents')
    .withIndex('by_send', (q) => q.eq('sendId', event.sendId))
    .collect();
  if (existing.some((e) => e.type === event.type && e.eventAt === event.eventAt)) return false;
  await ctx.db.insert('campaignEvents', event);

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
  return true;
}

/**
 * Record a Brevo transactional-email webhook event (POST /webhooks/brevo/email)
 * against the send it belongs to, correlated via `brevoMessageId`. Also stamps
 * the send's first-only `openedAt`/`clickedAt` markers.
 */
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

    await insertCampaignEventIfNew(ctx, {
      campaignId: send.campaignId,
      sendId: send._id,
      leadId: send.leadId,
      type: args.type,
      eventAt: args.eventAt,
      url: args.url,
      reason: args.reason,
    });

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

/**
 * Handle a Brevo SMS webhook event. Correlated to its send by `brevoMessageId`
 * first, then by recipient phone (inbound STOP/replied events carry a fresh id
 * but always the phone). Logs a campaign event, stamps the send's first-only
 * lifecycle marker (delivered/replied/unsubscribed/bounced) that powers the SMS
 * campaign metrics, and on a STOP (`unsubscribed`/`bl` = blacklisted) revokes the
 * lead's SMS consent. Idempotent: replays find the marker/consent already set.
 */
export const handleSmsEvent = internalMutation({
  args: {
    brevoMessageId: v.optional(v.string()),
    // Recipient phone from the event (present on inbound STOP/replied). Matched
    // against campaignSends.smsRecipient after stripping to digits — an inbound
    // event carries a fresh messageId that never matches by_brevoMessageId.
    recipient: v.optional(v.string()),
    msgStatus: v.string(),
    eventAt: v.number(),
  },
  handler: async (ctx, args) => {
    const type = SMS_EVENT_TYPE[args.msgStatus];
    if (!type) return;

    // Message id first — precise, and delivery/reply/bounce events carry the
    // original outbound id. Fall back to phone for inbound events (a STOP arrives
    // with a fresh id that matches no send, but always carries the recipient).
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

    await ctx.db.patch(lead._id, {
      marketingConsent: lead.marketingConsent.filter((channel) => channel !== 'sms'),
      consentUpdatedAt: Date.now(),
      consentSource: 'sms_stop',
      updatedAt: Date.now(),
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

/**
 * One-off backfill: stamp `smsRecipient` on SMS sends created before that field
 * existed, so an inbound STOP (which arrives with a fresh messageId + the phone)
 * can be correlated by phone. Paginated — call repeatedly, feeding back
 * `continueCursor`, until `isDone`:
 *   bunx convex run features/crm/internal:backfillSmsRecipient '{}' --prod
 *   bunx convex run features/crm/internal:backfillSmsRecipient '{"cursor":"..."}' --prod
 */
export const backfillSmsRecipient = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('campaignSends')
      .paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let patched = 0;
    for (const send of page.page) {
      if (send.phone && send.smsRecipient === undefined) {
        const recipient = toBrevoRecipient(send.phone);
        if (recipient) {
          await ctx.db.patch(send._id, { smsRecipient: recipient });
          patched++;
        }
      }
    }
    return { patched, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * Handle a click on a per-recipient tracked link (public GET /l/<token> HTTP
 * route). Sets the link's configured value on the lead property targeted by
 * the link (built-in field or custom property) and
 * stamps `clickedAt` (token row + send row) on first click. Repeated clicks
 * re-apply the same value and add a campaignEvents row, nothing else. No audit
 * log — there is no authenticated user (same as updateConsentByToken); a
 * system lead note records the first click instead.
 */
export const handleTrackedLinkClick = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ found: boolean; redirectUrl?: string }> => {
    const tokenRow = await ctx.db
      .query('campaignLinkTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
    if (!tokenRow) return { found: false };

    const now = Date.now();
    const firstClick = tokenRow.clickedAt === undefined;
    if (firstClick) await ctx.db.patch(tokenRow._id, { clickedAt: now });

    const send = await ctx.db.get(tokenRow.sendId);
    if (send && send.clickedAt === undefined) {
      await ctx.db.patch(tokenRow.sendId, { clickedAt: now });
    }

    const campaign = await ctx.db.get(tokenRow.campaignId);
    const link = campaign?.trackedLinks?.find((l) => l.key === tokenRow.linkKey);

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

    // Apply the lead update; soft-fail (still redirect) if the lead or a
    // custom-property definition disappeared since the campaign was sent.
    const lead = await ctx.db.get(tokenRow.leadId);
    if (link && lead && lead.deletedAt === undefined) {
      const patch = await buildLeadTargetPatch(ctx, lead, link.target, link.value);
      if (patch) {
        const changedFields = diffLeadFilterFields(lead, patch);
        await ctx.db.patch(lead._id, { ...patch, updatedAt: now });
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

    return { found: true, redirectUrl: link?.redirectUrl };
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

/**
 * Mark every still-`pending` send of a campaign as `failed` with a reason, and
 * bump `failedCount` accordingly. Used when the send path can't proceed (no
 * usable provider, or a fatal error mid-drain) so the failures surface in the UI
 * and become retry-able instead of orphaning rows in `pending`.
 */
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
