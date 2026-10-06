import type { Trigger } from 'convex-helpers/server/triggers';
import type { DataModel, Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  CAMPAIGN_STAT_KEYS,
  type CampaignStatKey,
  type CampaignStats,
} from '../../_lib/validators/crm';

const HOUR_MS = 3_600_000;

export const emptyStats = (): CampaignStats => ({
  ...(Object.fromEntries(CAMPAIGN_STAT_KEYS.map((key) => [key, 0])) as Record<
    CampaignStatKey,
    number
  >),
  sentByHour: {},
});

/** The keys one send counts for, and the hour of its send when it has one. */
function sendCounts(send: Doc<'campaignSends'>): { keys: CampaignStatKey[]; hour: string | null } {
  const keys: CampaignStatKey[] = [];
  if (send.status === 'pending') keys.push('pending');
  if (send.status === 'skipped_no_email' || send.status === 'skipped_no_phone')
    keys.push('skipped');
  if (send.deliveredAt !== undefined) keys.push('delivered');
  if (send.openedAt !== undefined) keys.push('opened');
  if (send.clickedAt !== undefined) keys.push('clicked');
  if (send.repliedAt !== undefined) keys.push('replied');
  if (send.unsubscribedAt !== undefined) keys.push('unsubscribed');
  if (send.bouncedAt !== undefined) keys.push('bounced');
  const hour =
    send.sentAt === undefined ? null : String(Math.floor(send.sentAt / HOUR_MS) * HOUR_MS);
  return { keys, hour };
}

/** The stats with one send added (`sign` 1) or taken away (-1); a count never goes below zero, a send the counters never saw (written before them, or seeded) cannot owe them anything. */
export function addSend(
  stats: CampaignStats,
  send: Doc<'campaignSends'>,
  sign: 1 | -1,
): CampaignStats {
  const { keys, hour } = sendCounts(send);
  const next = { ...stats, sentByHour: { ...stats.sentByHour } };
  for (const key of keys) next[key] = Math.max(0, next[key] + sign);
  if (hour !== null) {
    const count = Math.max(0, (next.sentByHour[hour] ?? 0) + sign);
    if (count === 0) delete next.sentByHour[hour];
    else next.sentByHour[hour] = count;
  }
  return next;
}

/** The campaign follows every write of one of its sends; a change that counts for nothing writes nothing. */
export const campaignStatsTrigger: Trigger<MutationCtx, DataModel, 'campaignSends'> = async (
  ctx,
  change,
) => {
  const before = change.oldDoc ? sendCounts(change.oldDoc) : null;
  const after = change.newDoc ? sendCounts(change.newDoc) : null;
  if (
    before?.hour === after?.hour &&
    [...(before?.keys ?? [])].sort().join() === [...(after?.keys ?? [])].sort().join()
  ) {
    return;
  }
  const campaignId = (change.newDoc ?? change.oldDoc).campaignId;
  const campaign = await ctx.db.get(campaignId);
  if (!campaign) return;
  let stats = campaign.stats ?? emptyStats();
  if (change.oldDoc) stats = addSend(stats, change.oldDoc, -1);
  if (change.newDoc) stats = addSend(stats, change.newDoc, 1);
  await ctx.db.patch(campaignId, { stats });
};
