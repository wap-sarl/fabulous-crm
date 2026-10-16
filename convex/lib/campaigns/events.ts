import type { MutationCtx } from '../../_generated/server';
import type { CampaignEvent, CampaignEventType } from '../../_lib/validators/crm';
import type { WorkflowEmailEvent, WorkflowSmsEvent } from '../../_lib/validators/workflows';
import { applyConsentChoice } from '../consent/choice';
import { insertSystemNote } from '../leads/notes';
import { BEHAVIOURAL_CAMPAIGN_EVENTS, profilingExcluded, stampLeadSignal } from '../leads/signals';
import { dispatchWorkflowTrigger } from '../workflows/dispatch';

/** Brevo's payloads vary between snake_case and camelCase, so both spellings are accepted; an unmapped event is acknowledged and dropped. */
export const BREVO_EMAIL_EVENT_TYPE: Record<string, CampaignEventType> = {
  delivered: 'delivered',
  opened: 'opened',
  unique_opened: 'opened',
  uniqueOpened: 'opened',
  click: 'clicked',
  // The statistics endpoint (the backfill) names the events in the plural.
  clicks: 'clicked',
  hardBounces: 'hard_bounce',
  softBounces: 'soft_bounce',
  hard_bounce: 'hard_bounce',
  hardBounce: 'hard_bounce',
  soft_bounce: 'soft_bounce',
  softBounce: 'soft_bounce',
  spam: 'spam',
  complaint: 'spam',
  unsubscribed: 'unsubscribed',
  blocked: 'blocked',
  invalid: 'invalid',
  invalid_email: 'invalid',
  error: 'error',
};

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
export async function recordEmailEvent(
  ctx: MutationCtx,
  args: {
    brevoMessageId: string;
    type: CampaignEventType;
    eventAt: number;
    url?: string;
    reason?: string;
  },
): Promise<void> {
  const send = await ctx.db
    .query('campaignSends')
    .withIndex('by_brevoMessageId', (q) => q.eq('brevoMessageId', args.brevoMessageId))
    .first();
  if (!send) {
    // Dev-whitelist skips and non-campaign transactional mail land here.
    console.warn('Brevo email webhook: no campaignSend for messageId', args.brevoMessageId);
    return;
  }

  // Brevo's click tracking wraps the consent link like any other: a click on it is an unsubscribe, not an engagement.
  const type =
    args.type === 'clicked' && args.url?.includes('/consent/') ? 'unsubscribed' : args.type;
  const outcome = await insertCampaignEventIfNew(ctx, {
    campaignId: send.campaignId,
    sendId: send._id,
    leadId: send.leadId,
    type,
    eventAt: args.eventAt,
    url: args.url,
    reason: args.reason,
  });
  // An objection leaves the send unstamped too: nothing says the person opened or clicked.
  if (outcome === 'excluded') return;

  if (type === 'opened' && send.openedAt === undefined) {
    await ctx.db.patch(send._id, { openedAt: args.eventAt });
  }
  if (type === 'clicked' && send.clickedAt === undefined) {
    await ctx.db.patch(send._id, { clickedAt: args.eventAt });
  }
  if (type === 'unsubscribed' && send.unsubscribedAt === undefined) {
    await ctx.db.patch(send._id, { unsubscribedAt: args.eventAt });
  }
}

/** Brevo's `msg_status` as the maps above key it: a reply that starts with STOP is an opt-out even when reported as a plain reply (transactional SMS), and the registration names `unsubscribe` / `blacklisted` stand for the payload values. */
function normalizeSmsStatus(msgStatus: string, reply?: string): string {
  const status = msgStatus.toLowerCase();
  if (status === 'unsubscribe') return 'unsubscribed';
  if (status === 'blacklisted') return 'bl';
  if (status === 'replied' && reply && /^\s*stop\b/i.test(reply)) return 'unsubscribed';
  return status;
}

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
export async function recordSmsEvent(
  ctx: MutationCtx,
  args: {
    brevoMessageId?: string;
    recipient?: string;
    reply?: string;
    msgStatus: string;
    eventAt: number;
  },
): Promise<void> {
  const msgStatus = normalizeSmsStatus(args.msgStatus, args.reply);
  const type = SMS_EVENT_TYPE[msgStatus];
  if (!type) {
    console.warn('SMS webhook: ignored status', args.msgStatus);
    return;
  }

  // The message id first, it is precise; the phone as a fallback, as a STOP arrives with a fresh id that matches no send but always carries the recipient.
  let send = args.brevoMessageId
    ? await ctx.db
        .query('campaignSends')
        .withIndex('by_brevoMessageId', (q) => q.eq('brevoMessageId', args.brevoMessageId))
        .first()
    : null;
  const recipientDigits = args.recipient?.replace(/\D/g, '');
  // The latest send to that number: the one the person answers.
  if (!send && recipientDigits) {
    send = await ctx.db
      .query('campaignSends')
      .withIndex('by_smsRecipient', (q) => q.eq('smsRecipient', recipientDigits))
      .order('desc')
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
  const marker = SMS_STATUS_MARKER[msgStatus];
  if (marker && send[marker] === undefined) {
    await ctx.db.patch(send._id, { [marker]: args.eventAt });
  }

  // Every SMS carries the STOP mention, so a STOP on any send is an opt-out, whatever the campaign's type.
  if (msgStatus !== 'unsubscribed' && msgStatus !== 'bl') return;

  const lead = await ctx.db.get(send.leadId);
  if (!lead || lead.deletedAt !== undefined) return;
  if (!lead.marketingConsent.includes('sms')) return;

  // The channel goes, and each SMS type with it; the events, the audit entry and the workflows follow.
  await applyConsentChoice(
    ctx,
    lead,
    { channels: lead.marketingConsent.filter((channel) => channel !== 'sms') },
    { source: 'sms_stop' },
  );

  // So the opt-out is visible in the lead timeline.
  await insertSystemNote(
    ctx,
    lead._id,
    'Désinscription SMS : le contact a répondu STOP (événement Brevo).',
    Date.now(),
  );
}
