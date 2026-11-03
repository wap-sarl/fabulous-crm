import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { emitEvent } from '../notifications/emit';

/** A campaign with no pending send left ends sent when something left, failed otherwise; one stopped meanwhile keeps its word. Its creator is told either way. */
export async function completeCampaign(
  ctx: MutationCtx,
  campaignId: Id<'campaigns'>,
): Promise<void> {
  const campaign = await ctx.db.get(campaignId);
  if (campaign?.status !== 'sending') return;
  await ctx.db.patch(campaignId, {
    status: campaign.sentCount > 0 ? 'sent' : 'failed',
    updatedAt: Date.now(),
  });
  await emitEvent(ctx, { kind: 'campaign.finished', entity: { type: 'campaign', id: campaignId } });
}
