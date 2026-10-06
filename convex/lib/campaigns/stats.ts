import type { Trigger } from 'convex-helpers/server/triggers';
import { internal } from '../../_generated/api';
import type { DataModel, Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import {
  CAMPAIGN_STAT_KEYS,
  type CampaignStatKey,
  type CampaignStats,
} from '../../_lib/validators/crm';

const HOUR_MS = 3_600_000;
// A write lands on one row out of sixteen: the provider events of one campaign, each its own mutation, meet sixteen times less often than on the campaign. More rows may be added at any time, the sum reads them all; fewer would leave the rows above behind.
const STAT_SHARDS = 16;
// A page of a count reads its sends and writes one row and the campaign: far below what a transaction may do.
const COUNT_PAGE = 500;

const emptyStats = (): CampaignStats => ({
  ...(Object.fromEntries(CAMPAIGN_STAT_KEYS.map((key) => [key, 0])) as Record<
    CampaignStatKey,
    number
  >),
  sentByHour: {},
});

/** What one send counts for, added (`sign` 1) or taken away (-1): its keys, and the hour of its send when it has one. */
function sendStats(send: Doc<'campaignSends'>, sign: 1 | -1): CampaignStats {
  const stats = emptyStats();
  if (send.status === 'pending') stats.pending = sign;
  if (send.status === 'skipped_no_email' || send.status === 'skipped_no_phone')
    stats.skipped = sign;
  if (send.deliveredAt !== undefined) stats.delivered = sign;
  if (send.openedAt !== undefined) stats.opened = sign;
  if (send.clickedAt !== undefined) stats.clicked = sign;
  if (send.repliedAt !== undefined) stats.replied = sign;
  if (send.unsubscribedAt !== undefined) stats.unsubscribed = sign;
  if (send.bouncedAt !== undefined) stats.bounced = sign;
  if (send.sentAt !== undefined) {
    stats.sentByHour[String(Math.floor(send.sentAt / HOUR_MS) * HOUR_MS)] = sign;
  }
  return stats;
}

/** Two sets of counters added up; an hour that comes to nothing is dropped. */
function addStats(a: CampaignStats, b: CampaignStats): CampaignStats {
  const sum = { ...a, sentByHour: { ...a.sentByHour } };
  for (const key of CAMPAIGN_STAT_KEYS) sum[key] += b[key];
  for (const [hour, count] of Object.entries(b.sentByHour)) {
    const total = (sum.sentByHour[hour] ?? 0) + count;
    if (total === 0) delete sum.sentByHour[hour];
    else sum.sentByHour[hour] = total;
  }
  return sum;
}

const countsNothing = (stats: CampaignStats): boolean =>
  CAMPAIGN_STAT_KEYS.every((key) => stats[key] === 0) && Object.keys(stats.sentByHour).length === 0;

const shardsOf = (ctx: Pick<QueryCtx, 'db'>, campaignId: Id<'campaigns'>) =>
  ctx.db
    .query('campaignStatShards')
    .withIndex('by_campaign_shard', (q) => q.eq('campaignId', campaignId))
    .take(STAT_SHARDS);

/** The counters of a campaign, its rows summed; the rows hold changes and only their sum means something, shown at zero should it ever come out below. */
export async function readCampaignStats(
  ctx: Pick<QueryCtx, 'db'>,
  campaignId: Id<'campaigns'>,
): Promise<CampaignStats> {
  const shards = await shardsOf(ctx, campaignId);
  const sum = shards.reduce((total, shard) => addStats(total, shard.stats), emptyStats());
  for (const key of CAMPAIGN_STAT_KEYS) sum[key] = Math.max(0, sum[key]);
  for (const [hour, count] of Object.entries(sum.sentByHour)) {
    if (count < 0) delete sum.sentByHour[hour];
  }
  return sum;
}

// One row per campaign and per transaction, found by its scheduler, the one object a mutation and its triggers share: a batch marking two hundred sends then meets the events of one row, not of all.
const shardOfTransaction = new WeakMap<object, Map<Id<'campaigns'>, number>>();

function shardFor(ctx: MutationCtx, campaignId: Id<'campaigns'>): number {
  const picked = shardOfTransaction.get(ctx.scheduler) ?? new Map<Id<'campaigns'>, number>();
  shardOfTransaction.set(ctx.scheduler, picked);
  const shard = picked.get(campaignId) ?? Math.floor(Math.random() * STAT_SHARDS);
  picked.set(campaignId, shard);
  return shard;
}

/** A change lands on one row of the campaign, picked at random. */
async function addToShard(
  ctx: MutationCtx,
  campaignId: Id<'campaigns'>,
  change: CampaignStats,
): Promise<void> {
  const shard = shardFor(ctx, campaignId);
  const row = await ctx.db
    .query('campaignStatShards')
    .withIndex('by_campaign_shard', (q) => q.eq('campaignId', campaignId).eq('shard', shard))
    .unique();
  if (row) await ctx.db.patch(row._id, { stats: addStats(row.stats, change) });
  else await ctx.db.insert('campaignStatShards', { campaignId, shard, stats: change });
}

/** The counters follow every write of a send the count has reached, and write a row of the campaign, never the campaign; a send the count has not reached is left to it, a change that counts for nothing writes nothing. */
export const campaignStatsTrigger: Trigger<MutationCtx, DataModel, 'campaignSends'> = async (
  ctx,
  change,
) => {
  const delta = addStats(
    change.oldDoc ? sendStats(change.oldDoc, -1) : emptyStats(),
    change.newDoc ? sendStats(change.newDoc, 1) : emptyStats(),
  );
  if (countsNothing(delta)) return;
  const send = change.newDoc ?? change.oldDoc;
  const campaign = await ctx.db.get(send.campaignId);
  const through = campaign?.statsCountedThrough;
  if (through === undefined || (through !== 'all' && send._creationTime > through)) return;
  await addToShard(ctx, send.campaignId, delta);
};

/** The count of a campaign starts over: its rows go, no send is held any more, and the pages read them again. Exact whatever is written meanwhile, so it runs at any time and as often as wanted. */
export async function startStatsCount(
  ctx: MutationCtx,
  campaignId: Id<'campaigns'>,
): Promise<void> {
  for (const shard of await shardsOf(ctx, campaignId)) await ctx.db.delete(shard._id);
  await ctx.db.patch(campaignId, { statsCountedThrough: 0 });
  await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.countCampaignStatsPage, {
    campaignId,
  });
}

/** One page of the sends of a campaign added to its counters, oldest first, and the mark moved in the same transaction: the trigger takes each send over exactly when the count has read it. The mark lives on the campaign, not in the arguments, so two counts of one campaign share the pages instead of counting twice. */
export async function countStatsPage(
  ctx: MutationCtx,
  args: { campaignId: Id<'campaigns'>; pageSize?: number },
): Promise<{ isDone: boolean }> {
  const campaign = await ctx.db.get(args.campaignId);
  const through = campaign?.statsCountedThrough;
  if (typeof through !== 'number') return { isDone: true };

  const size = args.pageSize ?? COUNT_PAGE;
  const read = await ctx.db
    .query('campaignSends')
    .withIndex('by_campaign', (q) =>
      q.eq('campaignId', args.campaignId).gt('_creationTime', through),
    )
    .take(size + 1);
  const isDone = read.length <= size;
  // The mark is a time: the page stops before the instant of the first send it leaves, so that sends created at one instant are never split.
  const sends = isDone
    ? read
    : read.filter((send) => send._creationTime < read[size]._creationTime);
  // More sends at one instant than a page holds: read further.
  if (sends.length === 0 && !isDone) return countStatsPage(ctx, { ...args, pageSize: size * 2 });
  const last = sends[sends.length - 1]?._creationTime ?? through;

  const counted = sends.reduce((sum, send) => addStats(sum, sendStats(send, 1)), emptyStats());
  if (!countsNothing(counted)) await addToShard(ctx, args.campaignId, counted);
  await ctx.db.patch(args.campaignId, { statsCountedThrough: isDone ? 'all' : last });
  if (!isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.campaigns.internal.countCampaignStatsPage,
      args,
    );
  }
  return { isDone };
}
