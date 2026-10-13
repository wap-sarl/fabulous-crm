import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

const HOUR_MS = 3_600_000;
// The latest events of a recipient the choice reads: a page of a hundred optimised recipients reads four thousand rows at most.
const OPEN_HISTORY = 40;

/** The hour of the day (UTC) the recipient opened most, the most recently opened on a tie; null without an open. The next occurrence of that hour is the same wall-clock hour, a change of daylight-saving time aside. */
export function bestOpenHour(
  events: ReadonlyArray<Pick<Doc<'campaignEvents'>, 'type' | 'eventAt'>>,
): number | null {
  const hours = new Map<number, { count: number; last: number }>();
  for (const event of events) {
    if (event.type !== 'opened') continue;
    const hour = new Date(event.eventAt).getUTCHours();
    const seen = hours.get(hour) ?? { count: 0, last: 0 };
    hours.set(hour, { count: seen.count + 1, last: Math.max(seen.last, event.eventAt) });
  }
  let best: { hour: number; count: number; last: number } | null = null;
  for (const [hour, seen] of hours) {
    if (!best || seen.count > best.count || (seen.count === best.count && seen.last > best.last)) {
      best = { hour, ...seen };
    }
  }
  return best ? best.hour : null;
}

/** The next time at `hour` (UTC) from `base`: `base` itself within that hour, else the start of that hour within the day that follows. */
export function nextSlot(base: number, hour: number): number {
  const baseHour = new Date(base).getUTCHours();
  if (baseHour === hour) return base;
  const hourStart = Math.floor(base / HOUR_MS) * HOUR_MS;
  return hourStart + ((hour - baseHour + 24) % 24) * HOUR_MS;
}

/** When a recipient is sent to, from `base`: at the hour they open most within the day that follows, or at `base` without an open on record. */
export async function loadSendAt(
  ctx: Pick<QueryCtx, 'db'>,
  leadId: Id<'leads'>,
  base: number,
): Promise<number> {
  const events = await ctx.db
    .query('campaignEvents')
    .withIndex('by_lead_eventAt', (q) => q.eq('leadId', leadId))
    .order('desc')
    .take(OPEN_HISTORY);
  const hour = bestOpenHour(events);
  return hour === null ? base : nextSlot(base, hour);
}
