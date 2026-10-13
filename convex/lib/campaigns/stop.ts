import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

// Cancelling a send is one patch: 200 per transaction keeps the chain short and far below the write limit.
const CANCEL_BATCH = 200;

/** One page of the pending sends of a stopped campaign marked cancelled; the next page is scheduled while one is full. The counters follow through the trigger, as skipped. */
export async function cancelPendingSends(
  ctx: MutationCtx,
  args: { campaignId: Id<'campaigns'>; batchSize?: number },
): Promise<{ cancelled: number; isDone: boolean }> {
  const campaign = await ctx.db.get(args.campaignId);
  // Sent again meanwhile: the resend owns the pending sends now.
  if (campaign?.status !== 'stopped') return { cancelled: 0, isDone: true };
  const limit = args.batchSize ?? CANCEL_BATCH;
  const pending = await ctx.db
    .query('campaignSends')
    .withIndex('by_campaign_status', (q) =>
      q.eq('campaignId', args.campaignId).eq('status', 'pending'),
    )
    .take(limit);
  for (const send of pending) await ctx.db.patch(send._id, { status: 'cancelled' });
  if (pending.length >= limit) {
    await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.cancelPendingSends, args);
    return { cancelled: pending.length, isDone: false };
  }
  return { cancelled: pending.length, isDone: true };
}
