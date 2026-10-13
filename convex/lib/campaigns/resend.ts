import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import type { CampaignTrackedLink } from '../../_lib/validators/crm';
import type { LifecycleConfig } from '../../_lib/validators/lifecycle';
import { consentOrigin } from '../config/appUrl';
import { deferUnlessAllowed, trySend } from '../extensions/gates';
import { loadLifecycleConfig } from '../leads/lifecycle';
import { loadPropertyDefsById, type PropertyDefinitionDoc } from '../properties/definitions';
import { toBrevoRecipient } from '../sms/brevo';
import { scheduleDrain } from './drain';
import { buildSendParams } from './params';
import { loadSendAt } from './sendTime';

// Each send re-queued is one patch, plus one token per tracked link for a send that had none: 200 stay far below Convex's 8,192 writes per transaction.
const RESEND_BATCH = 200;
// An optimised recipient also reads their recent events (sendTime.ts): a shorter page keeps the reads of one transaction bounded.
const RESEND_BATCH_OPTIMIZED = 100;

/** Tracked links need their base address: refused before anything is re-queued, not in a batch nobody watches. */
export function requireLinkBase(campaign: Doc<'campaigns'>): string | undefined {
  const linkBase = process.env.CONVEX_SITE_URL;
  if ((campaign.trackedLinks ?? []).length > 0 && !linkBase) throw refusal('link_base_missing');
  return linkBase;
}

type ResendContext = {
  isSms: boolean;
  optimized: boolean;
  trackedLinks: CampaignTrackedLink[];
  defsById: Map<string, PropertyDefinitionDoc>;
  consentBase: string;
  linkBase: string | undefined;
  lifecycle: LifecycleConfig;
};

/** Shared context for (re-)materializing a campaign's sends on resend. */
export async function loadResendContext(
  ctx: MutationCtx,
  campaign: Doc<'campaigns'>,
): Promise<ResendContext> {
  return {
    isSms: (campaign.channel ?? 'email') === 'sms',
    optimized: campaign.sendTimeOptimized === true,
    trackedLinks: campaign.trackedLinks ?? [],
    defsById: await loadPropertyDefsById(ctx, 'lead'),
    consentBase: consentOrigin(),
    linkBase: requireLinkBase(campaign),
    lifecycle: await loadLifecycleConfig(ctx),
  };
}

/** Sent and failed rows keep their contact and tokens, skipped rows never had any and get fresh ones; false when the lead still has no contact. */
export async function requeueSend(
  ctx: MutationCtx,
  send: Doc<'campaignSends'>,
  remat: ResendContext,
): Promise<boolean> {
  // What the previous send earned goes, so the counters say what the new one does; a reply and an unsubscription are about the person and stay. An optimised campaign keeps each recipient's hour; a holdout re-queued before its test was decided is due now, so the decision comes at once on the results there are, and says whether it had any.
  const now = Date.now();
  const reset = {
    status: 'pending' as const,
    sendAt: remat.optimized ? await loadSendAt(ctx, send.leadId, now) : now,
    error: undefined,
    brevoMessageId: undefined,
    openedAt: undefined,
    clickedAt: undefined,
    sentAt: undefined,
    deliveredAt: undefined,
    bouncedAt: undefined,
  };
  if (send.status === 'skipped_no_email' || send.status === 'skipped_no_phone') {
    const lead = await ctx.db.get(send.leadId);
    const contact =
      lead && lead.deletedAt == null ? (remat.isSms ? lead.phone : lead.email) : undefined;
    if (!lead || !contact) return false;
    const { params, tokens } = buildSendParams(lead, remat);
    await ctx.db.patch(send._id, {
      ...reset,
      email: remat.isSms ? undefined : contact,
      phone: remat.isSms ? contact : undefined,
      smsRecipient: remat.isSms ? (toBrevoRecipient(contact) ?? undefined) : undefined,
      params,
    });
    for (const { linkKey, token } of tokens) {
      await ctx.db.insert('campaignLinkTokens', {
        token,
        campaignId: send.campaignId,
        sendId: send._id,
        leadId: lead._id,
        linkKey,
      });
    }
  } else {
    await ctx.db.patch(send._id, reset);
  }
  return true;
}

/** One page of the sends of a campaign re-queued, the next page scheduled, the drain after the last; `only: 'cancelled'` resumes a stopped campaign, re-queuing what was cancelled and nothing else. The paging state is returned so tests can drive the chain without the scheduler. */
export async function resendBatch(
  ctx: MutationCtx,
  args: {
    campaignId: Id<'campaigns'>;
    cursor?: string;
    resent?: number;
    batchSize?: number;
    only?: 'cancelled';
  },
): Promise<{ isDone: boolean; continueCursor: string | null }> {
  const campaign = await ctx.db.get(args.campaignId);
  // Deleted mid-resend (or unexpected state): stop the chain quietly.
  if (!campaign || campaign.deletedAt != null || campaign.status !== 'preparing') {
    return { isDone: true, continueCursor: null };
  }
  // Deferred (e.g. a suspended deployment): the same page runs again later, nothing changes.
  if (
    await deferUnlessAllowed(
      ctx,
      'campaign_prepare',
      internal.features.campaigns.internal.resendCampaignBatch,
      args,
    )
  ) {
    return { isDone: false, continueCursor: args.cursor ?? null };
  }

  const remat = await loadResendContext(ctx, campaign);
  const paging = {
    cursor: args.cursor ?? null,
    numItems: args.batchSize ?? (remat.optimized ? RESEND_BATCH_OPTIMIZED : RESEND_BATCH),
  };
  const page =
    args.only === 'cancelled'
      ? await ctx.db
          .query('campaignSends')
          .withIndex('by_campaign_status', (q) =>
            q.eq('campaignId', args.campaignId).eq('status', 'cancelled'),
          )
          .paginate(paging)
      : await ctx.db
          .query('campaignSends')
          .withIndex('by_campaign', (q) => q.eq('campaignId', args.campaignId))
          .paginate(paging);

  let resent = args.resent ?? 0;
  let stillSkipped = 0;
  for (const send of page.page) {
    if (await requeueSend(ctx, send, remat)) resent++;
    else stillSkipped++;
  }
  // `sentCount` was reset when the resend started; the skipped ones add up page by page, the drain counts the rest.
  const failedCount = campaign.failedCount + stillSkipped;

  // Asked on every page with the running count, and as a resend on the last with the exact one: a refused resend stops within one page of the limit, and what was re-queued is failed so it shows and can be tried again.
  const refused =
    resent > 0
      ? await trySend(ctx, {
          source: 'campaign',
          channel: campaign.channel ?? 'email',
          count: resent,
          stage: page.isDone ? 'resend' : 'preparing',
        })
      : null;
  if (refused) {
    // `sending` while the pending sends are failed: the page says so, and no second resend starts meanwhile.
    await ctx.db.patch(args.campaignId, {
      failedCount,
      status: 'sending',
      failureReason: refused,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.failPendingSends, {
      campaignId: args.campaignId,
      error: `Renvoi refusé (${refused}).`,
    });
    return { isDone: true, continueCursor: page.continueCursor };
  }

  if (!page.isDone) {
    await ctx.db.patch(args.campaignId, { failedCount });
    await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.resendCampaignBatch, {
      campaignId: args.campaignId,
      cursor: page.continueCursor,
      resent,
      batchSize: args.batchSize,
      only: args.only,
    });
    return { isDone: false, continueCursor: page.continueCursor };
  }

  // Nothing to re-queue: a resend of all ends sent as before, a resume ends as the stop left it, sent when something had left.
  const settled = args.only === 'cancelled' && campaign.sentCount === 0 ? 'failed' : 'sent';
  await ctx.db.patch(args.campaignId, {
    failedCount,
    status: resent > 0 ? 'sending' : settled,
    updatedAt: Date.now(),
  });
  if (resent > 0) {
    await scheduleDrain(ctx, args.campaignId, Date.now());
  }
  return { isDone: true, continueCursor: page.continueCursor };
}
