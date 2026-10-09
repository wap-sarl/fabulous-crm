import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { DAY_MS } from '../../_lib/time';

// A burst of visitors lands on one row out of eight per day, not on one document; the row is reached by its index, so a view reads and writes that row and no other.
const STAT_SHARDS = 8;

/** The UTC day a moment belongs to, as the rows are keyed. */
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** One view or one submission more for the page, today. */
export async function countForPage(
  ctx: MutationCtx,
  pageId: Id<'landingPages'>,
  what: 'views' | 'submissions',
): Promise<void> {
  const day = dayOf(Date.now());
  const shard = Math.floor(Math.random() * STAT_SHARDS);
  const row = await ctx.db
    .query('landingPageStats')
    .withIndex('by_page_day_shard', (q) => q.eq('pageId', pageId).eq('day', day).eq('shard', shard))
    .unique();
  if (row) await ctx.db.patch(row._id, { [what]: row[what] + 1 });
  else {
    await ctx.db.insert('landingPageStats', {
      pageId,
      day,
      shard,
      views: what === 'views' ? 1 : 0,
      submissions: what === 'submissions' ? 1 : 0,
    });
  }
}

export interface DayStats {
  day: string;
  views: number;
  submissions: number;
}

/** The counters of a page over the last `days` days, one entry per day with something, oldest first, and their totals. */
export async function statsOfPage(
  ctx: Pick<QueryCtx, 'db'>,
  pageId: Id<'landingPages'>,
  days: number,
): Promise<{ days: DayStats[]; views: number; submissions: number }> {
  const since = dayOf(Date.now() - (days - 1) * DAY_MS);
  const rows = await ctx.db
    .query('landingPageStats')
    .withIndex('by_page_day_shard', (q) => q.eq('pageId', pageId).gte('day', since))
    .take(STAT_SHARDS * (days + 1));
  const byDay = new Map<string, DayStats>();
  for (const row of rows as Doc<'landingPageStats'>[]) {
    const entry = byDay.get(row.day) ?? { day: row.day, views: 0, submissions: 0 };
    entry.views += row.views;
    entry.submissions += row.submissions;
    byDay.set(row.day, entry);
  }
  const list = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  return {
    days: list,
    views: list.reduce((sum, d) => sum + d.views, 0),
    submissions: list.reduce((sum, d) => sum + d.submissions, 0),
  };
}
