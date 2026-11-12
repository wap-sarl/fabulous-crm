import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { DEFAULT_TASKS_DUE_HOUR, DEFAULT_TIMEZONE } from '../../_lib/validators/appConfig';
import { zonedDayOf } from '../shared/zonedTime';
import { emitEvent } from './emit';

/** The titles a notification names before « et N autres ». */
const TITLES_NAMED = 3;

/** What one person has due that day: how many open tasks, and the first titles by due time; null with none. Their own index range, never the table: a task handed to a team and nobody is no one's. */
async function dueOf(
  ctx: MutationCtx,
  userId: Id<'users'>,
  start: number,
  end: number,
): Promise<{ count: number; titles: string[] } | null> {
  const activities = await ctx.db
    .query('activities')
    .withIndex('by_owner_status_dueAt', (q) =>
      q.eq('ownerId', userId).eq('status', 'open').gte('dueAt', start).lt('dueAt', end),
    )
    .collect();
  const live = activities.filter((activity) => activity.deletedAt === undefined);
  if (live.length === 0) return null;
  return { count: live.length, titles: live.slice(0, TITLES_NAMED).map((a) => a.title) };
}

/** Whether the person was already told of that day: the row's key names the day, read or not. */
async function toldOf(ctx: MutationCtx, day: string, userId: Id<'users'>): Promise<boolean> {
  const told = await ctx.db
    .query('notifications')
    .withIndex('by_dedupe_unread', (q) => q.eq('dedupeKey', `activity.due:${day}:${userId}`))
    .first();
  return told !== null;
}

/** Run each hour: when the organisation's clock shows its hour, one fact per live employee with an open task due that day, the day read in the organisation's time zone, each person's tasks read from their own index range; a person told of that day already is not told again, so a run that repeats tells nobody twice. Answers how many people were told. */
export async function tellTasksDue(ctx: MutationCtx, now = Date.now()): Promise<number> {
  const cfg = await ctx.db.query('appConfig').first();
  const today = zonedDayOf(now, cfg?.timezone ?? DEFAULT_TIMEZONE);
  if (today.hour !== (cfg?.tasksDueHour ?? DEFAULT_TASKS_DUE_HOUR)) return 0;
  const employees = await ctx.db
    .query('users')
    .withIndex('by_type_deleted', (q) => q.eq('type', 'employee').eq('deletedAt', undefined))
    .collect();
  let told = 0;
  for (const employee of employees) {
    if (await toldOf(ctx, today.key, employee._id)) continue;
    const due = await dueOf(ctx, employee._id, today.start, today.end);
    if (!due) continue;
    await emitEvent(ctx, {
      kind: 'activity.due',
      entity: { type: 'day', id: today.key },
      data: { userId: employee._id, count: due.count, titles: due.titles },
    });
    told += 1;
  }
  return told;
}
