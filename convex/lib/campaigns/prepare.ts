import type { ObjectType } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { consentOrigin } from '../config/appUrl';
import { deferUnlessAllowed, trySend } from '../extensions/gates';
import { loadLifecycleConfig } from '../leads/lifecycle';
import {
  type leadFilterArgs,
  loadAdvancedListMembers,
  loadListMemberIdsForLeads,
  matchesLeadFilters,
} from '../leads/tableFilters';
import { loadPropertyDefsById } from '../properties/definitions';
import { loadVisibility, scopedReader } from '../roles/visibility';
import { toBrevoRecipient } from '../sms/brevo';
import { buildSendParams } from './params';

// Each recipient writes one campaignSends row plus one campaignLinkTokens row per tracked link: 200 leads stay far below Convex's 8,192 writes per transaction.
const PREP_BATCH = 200;

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
    if (!matchesLeadFilters(lead, { ...args.filter, listMemberIds, advancedListMembers })) continue;
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
}
