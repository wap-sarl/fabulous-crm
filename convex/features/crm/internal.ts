import { v } from 'convex/values';
import { loadLifecycleConfig } from '../../lib/lifecycle';
import { internalQuery, type MutationCtx } from '../../_generated/server';
// Trigger-wrapped constructor: keeps the lead aggregates in sync (functions.ts).
import { internalMutation } from '../../_lib/functions';
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
import { internal } from '../../_generated/api';
import { appOrigin } from '../../lib';
import { buildSendParams } from './mutations';
import { loadPropertyDefsById } from '../../lib/properties';
import { loadVisibility, scopedReader } from '../../lib/visibility';
import { stampLeadSignal } from '../../lib/leadSignals';
import {
  leadFilterArgs,
  loadAdvancedListMembers,
  loadListMemberIdsForLeads,
  matchesLeadFilters,
} from './leadTableFilters';

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

// Leads examined per prepareCampaignBatch transaction. Each matched recipient
// writes 1 campaignSends row plus one campaignLinkTokens row per tracked link,
// so a 200-lead page stays far below Convex's 8,192-writes-per-transaction cap
// even with several tracked links.
const PREP_BATCH = 200;

export const prepareCampaignBatch = internalMutation({
  args: {
    campaignId: v.id('campaigns'),
    filter: v.object(leadFilterArgs),
    cursor: v.optional(v.string()),
  },
  // Returns the paging state so tests can drive the chain deterministically
  // without the scheduler; production runs on the self-scheduled chain below.
  handler: async (ctx, args): Promise<{ isDone: boolean; continueCursor: string | null }> => {
    const campaign = await ctx.db.get(args.campaignId);
    // Deleted mid-preparation (or unexpected state): stop the chain quietly.
    if (!campaign || campaign.deletedAt != null || campaign.status !== 'preparing') {
      return { isDone: true, continueCursor: null };
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
      .paginate({ cursor: args.cursor ?? null, numItems: PREP_BATCH });

    // List membership is resolved per page with indexed point reads — a full
    // member-set load (loadListMemberIds) is unbounded on large lists.
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

      // Rows are inserted only for sends that actually go out (skipped recipients
      // get dead URLs), but params/tokens are built the same way as on resend.
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

    if (!page.isDone) {
      await ctx.db.patch(args.campaignId, { totalCount, failedCount });
      await ctx.scheduler.runAfter(0, internal.features.crm.internal.prepareCampaignBatch, {
        campaignId: args.campaignId,
        filter: args.filter,
        cursor: page.continueCursor,
      });
      return { isDone: false, continueCursor: page.continueCursor };
    }

    // Last page: finalize. Any pending send (this batch or an earlier one)
    // means there is something to deliver.
    const hasPending = totalCount - failedCount > 0;
    await ctx.db.patch(args.campaignId, {
      totalCount,
      failedCount,
      status: hasPending ? 'sending' : 'sent',
    });
    if (hasPending) {
      await ctx.scheduler.runAfter(0, internal.features.crm.actions.sendCampaignBatch, {
        campaignId: args.campaignId,
      });
    }
    return { isDone: true, continueCursor: page.continueCursor };
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
