import type { ObjectType } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { DAY_MS } from '../../_lib/time';
import { isSubscribed } from '../../_lib/validators/subscriptions';
import { consentOrigin } from '../config/appUrl';
import { deferUnlessAllowed, trySend } from '../extensions/gates';
import { loadLifecycleConfig } from '../leads/lifecycle';
import {
  type leadFilterArgs,
  loadAdvancedListMembers,
  loadFilterSubscriptionTypes,
  loadListMemberIdsForLeads,
  matchesLeadFilters,
} from '../leads/tableFilters';
import { loadPropertyDefsById } from '../properties/definitions';
import { loadVisibility, scopedReader } from '../roles/visibility';
import { toBrevoRecipient } from '../sms/brevo';
import { buildSendParams } from './params';
import { scheduleDrain } from './drain';
import { loadSendAt } from './sendTime';
import { assignVariant } from './variants';

// Each recipient writes one campaignSends row plus one campaignLinkTokens row per tracked link: 200 leads stay far below Convex's 8,192 writes per transaction.
const PREP_BATCH = 200;
// An optimised recipient also reads their recent events (sendTime.ts): a shorter page keeps the reads of one transaction bounded.
const PREP_BATCH_OPTIMIZED = 100;
const HOUR_MS = 3_600_000;

/** One page of the recipients of a campaign, as sends; the paging state is returned so tests can drive the chain without the scheduler, production runs on the self-scheduled chain. */
export async function prepareBatch(
  ctx: MutationCtx,
  args: {
    campaignId: Id<'campaigns'>;
    filter: ObjectType<typeof leadFilterArgs>;
    cursor?: string;
    batchSize?: number;
  },
): Promise<{ isDone: boolean; continueCursor: string | null }> {
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
  const consentBase = consentOrigin();
  const linkBase = process.env.CONVEX_SITE_URL;
  const lifecycle = await loadLifecycleConfig(ctx);
  const creator = campaign.createdBy ? await ctx.db.get(campaign.createdBy) : null;
  const leadsDb = creator ? scopedReader(ctx, await loadVisibility(ctx, creator)) : ctx.db;
  const pageSize = campaign.sendTimeOptimized ? PREP_BATCH_OPTIMIZED : PREP_BATCH;
  const page = await leadsDb
    .query('leads')
    .paginate({ cursor: args.cursor ?? null, numItems: args.batchSize ?? pageSize });

  // List membership is resolved per page with indexed point reads: a full member set is unbounded on large lists.
  const pageIds = page.page.map((lead) => lead._id);
  const listMemberIds = await loadListMemberIdsForLeads(ctx, args.filter.listIds, pageIds);
  const advancedListMembers = await loadAdvancedListMembers(
    ctx,
    args.filter.advancedFilter,
    pageIds,
  );
  const subscriptionTypes = await loadFilterSubscriptionTypes(ctx, args.filter.advancedFilter);
  // The subscription the campaign writes under, checked here whatever the filter says: a contact out of it is no recipient.
  const subscription = campaign.subscriptionTypeId
    ? await ctx.db.get(campaign.subscriptionTypeId)
    : null;
  // The test group goes now, the holdout once the window has closed on this page's sends; optimised, the test sends spread over a day, so the window opens after it.
  const now = Date.now();
  const test = campaign.abTest;
  const testUntil = now + (campaign.sendTimeOptimized ? DAY_MS : 0);
  const holdoutAt = test ? testUntil + test.windowHours * HOUR_MS : now;

  let total = 0;
  let skipped = 0;
  for (const lead of page.page) {
    const filters = { ...args.filter, listMemberIds, advancedListMembers, subscriptionTypes };
    if (!matchesLeadFilters(lead, filters)) continue;
    if (subscription && !isSubscribed(lead, subscription)) continue;
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

    const variant = test ? assignVariant(args.campaignId, lead._id, test.splitPercent) : undefined;
    const base = test && variant === undefined ? holdoutAt : now;
    const sendAt = campaign.sendTimeOptimized ? await loadSendAt(ctx, lead._id, base) : base;
    const sendId = await ctx.db.insert('campaignSends', {
      campaignId: args.campaignId,
      leadId: lead._id,
      email: isSms ? undefined : lead.email,
      phone: isSms ? lead.phone : undefined,
      // Normalized recipient so an inbound STOP webhook can be matched by phone.
      smsRecipient: isSms ? (toBrevoRecipient(lead.phone) ?? undefined) : undefined,
      params,
      status: 'pending',
      variant,
      sendAt,
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
    await scheduleDrain(ctx, args.campaignId, Date.now());
  }
  return { isDone: true, continueCursor: page.continueCursor };
}
