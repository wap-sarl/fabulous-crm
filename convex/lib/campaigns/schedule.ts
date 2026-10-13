import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { refusal, refusalOf } from '../../_lib/refusal';
import { SCHEDULE_HORIZON_MS } from '../../_lib/validators/crm';
import { assertChannelDeliverable } from '../email/provider';
import { trySend } from '../extensions/gates';

/** A time still to come, within the year. */
export function checkScheduledAt(at: number): void {
  const now = Date.now();
  if (!Number.isFinite(at) || at <= now || at > now + SCHEDULE_HORIZON_MS) {
    throw refusal('schedule_time_invalid', {
      message: "L'heure d'envoi doit être à venir, dans l'année.",
    });
  }
}

/** The call that waits to start the campaign is cancelled, if it still waits. */
export async function cancelStart(ctx: MutationCtx, campaign: Doc<'campaigns'>): Promise<void> {
  if (!campaign.scheduledFnId) return;
  const job = await ctx.db.system.get(campaign.scheduledFnId);
  if (job?.state.kind === 'pending') await ctx.scheduler.cancel(campaign.scheduledFnId);
}

/** The campaign waits for `at`: the call that starts it is scheduled, the one before cancelled. */
export async function scheduleStart(
  ctx: MutationCtx,
  campaign: Doc<'campaigns'>,
  at: number,
): Promise<void> {
  await cancelStart(ctx, campaign);
  const scheduledFnId = await ctx.scheduler.runAt(
    at,
    internal.features.campaigns.internal.startScheduledCampaign,
    { campaignId: campaign._id },
  );
  await ctx.db.patch(campaign._id, {
    status: 'scheduled',
    scheduledAt: at,
    scheduledFnId,
    failureReason: undefined,
  });
}

/** What the creation checked, asked again when a scheduled campaign starts, months later maybe: the allowance and the provider. The code of the refusal, or null. */
export async function startRefusal(
  ctx: MutationCtx,
  campaign: Doc<'campaigns'>,
): Promise<string | null> {
  const channel = campaign.channel ?? 'email';
  try {
    await assertChannelDeliverable(await ctx.db.query('appConfig').first(), channel);
  } catch (error) {
    return refusalOf(error)?.code ?? 'start_refused';
  }
  return await trySend(ctx, { source: 'campaign', channel, count: 1, stage: 'create' });
}

/** The campaign starts: its recipients are prepared from the filter it kept, resolved now, and the drain follows. */
export async function startCampaign(ctx: MutationCtx, campaign: Doc<'campaigns'>): Promise<void> {
  await ctx.db.patch(campaign._id, {
    status: 'preparing',
    scheduledFnId: undefined,
    failureReason: undefined,
  });
  await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.prepareCampaignBatch, {
    campaignId: campaign._id,
    filter: campaign.filter ?? {},
  });
}
