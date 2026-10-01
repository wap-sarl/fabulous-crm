import type { MutationCtx } from '../../_generated/server';
import type { CampaignEvent, CampaignEventType } from '../../_lib/validators/crm';
import type { WorkflowEmailEvent, WorkflowSmsEvent } from '../../_lib/validators/workflows';
import { computeChanges, logAudit } from '../audit/log';
import { insertSystemNote } from '../leads/notes';
import { BEHAVIOURAL_CAMPAIGN_EVENTS, profilingExcluded, stampLeadSignal } from '../leads/signals';
import { dispatchWorkflowTrigger } from '../workflows/dispatch';

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
  args: { brevoMessageId?: string; recipient?: string; msgStatus: string; eventAt: number },
): Promise<void> {
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

  // So the opt-out is visible in the lead timeline.
  await insertSystemNote(
    ctx,
    lead._id,
    'Désinscription SMS : le contact a répondu STOP (événement Brevo).',
    Date.now(),
  );

  await dispatchWorkflowTrigger(ctx, lead._id, { type: 'consent_updated' });
}
