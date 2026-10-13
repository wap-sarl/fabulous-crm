import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

// A page of the campaigns being sent, checked by the hourly restart: far more than are ever sent at once.
const STUCK_PAGE = 100;

/** The drain's next call, scheduled and kept on the campaign: one chain per campaign, found again if it breaks. */
export async function scheduleDrain(
  ctx: MutationCtx,
  campaignId: Id<'campaigns'>,
  at: number,
): Promise<void> {
  const drainFnId = await ctx.scheduler.runAt(
    at,
    internal.features.campaigns.actions.sendCampaignBatch,
    { campaignId },
  );
  await ctx.db.patch(campaignId, { drainFnId });
}

/** The campaigns being sent whose chain is gone (a call that threw before scheduling the next) while a send is due: their drain is started again. The ids of those restarted. */
export async function restartStuckDrains(ctx: MutationCtx): Promise<Id<'campaigns'>[]> {
  const sending = await ctx.db
    .query('campaigns')
    .withIndex('by_status', (q) => q.eq('status', 'sending'))
    .take(STUCK_PAGE);
  const restarted: Id<'campaigns'>[] = [];
  const now = Date.now();
  for (const campaign of sending) {
    const job = campaign.drainFnId ? await ctx.db.system.get(campaign.drainFnId) : null;
    if (job && (job.state.kind === 'pending' || job.state.kind === 'inProgress')) continue;
    const due = await ctx.db
      .query('campaignSends')
      .withIndex('by_campaign_status_sendAt', (q) =>
        q.eq('campaignId', campaign._id).eq('status', 'pending').lte('sendAt', now),
      )
      .first();
    if (!due) continue;
    console.warn('Campaign drain restarted: its chain had stopped', campaign._id);
    await scheduleDrain(ctx, campaign._id, now);
    restarted.push(campaign._id);
  }
  return restarted;
}
