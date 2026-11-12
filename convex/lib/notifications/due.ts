import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { DEFAULT_TASKS_DUE_HOUR, DEFAULT_TIMEZONE } from '../../_lib/validators/appConfig';
import { loadAppConfig } from '../config/load';
import { resolveRoleAccess } from '../roles/access';
import { zonedDayOf } from '../shared/zonedTime';
import { emitEvent } from './emit';

/** The titles a notification names before « et N autres ». */
const TITLES_NAMED = 3;
/** How long after the hour a day may still be told: enough for the daylight-saving gap and a missed run or two, not so long that a deployment at 15:00 or an outage reminds everyone in the evening. A day outside the window is skipped. */
const CATCH_UP_HOURS = 3;

/** What one person has due that day: how many open activities, whatever their type, as the tasks page lists them, and the first titles by due time; null with none. Their own index range, never the table: an activity handed to a team and nobody is no one's. */
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

/** Whether a role may open the tasks page at all: a person whose role lost the module is not reminded of what they cannot open, nor shown the switch to refuse it. One resolution per distinct role. */
async function activitiesAllowed(
  ctx: MutationCtx,
  roles: Map<string, Promise<boolean>>,
  role: string | undefined,
): Promise<boolean> {
  const key = role ?? 'member';
  let allowed = roles.get(key);
  if (!allowed) {
    allowed = resolveRoleAccess(ctx, key).then(({ access }) => access.activities !== 'none');
    roles.set(key, allowed);
  }
  return await allowed;
}

/** Run every half hour: once the organisation's clock, in its time zone, has reached the chosen hour, one fact per live employee whose role has the activities module and who has an open activity due that day, each person's read from their own index range. The day is then written down on the engine's state row, so the runs that follow that day tell nobody again: a day without the hour (clocks going forward) is told at the next, a day with it twice (clocks going back) once, and a day whose window passed untold is left alone. Answers how many people were told. */
export async function tellTasksDue(ctx: MutationCtx, now = Date.now()): Promise<number> {
  const cfg = await loadAppConfig(ctx);
  const today = zonedDayOf(now, cfg?.timezone ?? DEFAULT_TIMEZONE);
  const due = cfg?.tasksDueHour ?? DEFAULT_TASKS_DUE_HOUR;
  if (today.hour < due || today.hour >= due + CATCH_UP_HOURS) return 0;
  if ((await ctx.db.query('notificationFanOut').first())?.tasksDueDay === today.key) return 0;
  const employees = await ctx.db
    .query('users')
    .withIndex('by_type_deleted', (q) => q.eq('type', 'employee').eq('deletedAt', undefined))
    .collect();
  const roles = new Map<string, Promise<boolean>>();
  let told = 0;
  for (const employee of employees) {
    if (!(await activitiesAllowed(ctx, roles, employee.role))) continue;
    const due = await dueOf(ctx, employee._id, today.start, today.end);
    if (!due) continue;
    await emitEvent(ctx, {
      kind: 'activity.due',
      entity: { type: 'day', id: today.key },
      data: { userId: employee._id, count: due.count, titles: due.titles },
    });
    told += 1;
  }
  // Read again: a fact emitted above may have created the row.
  const state = await ctx.db.query('notificationFanOut').first();
  if (state) await ctx.db.patch(state._id, { tasksDueDay: today.key });
  else await ctx.db.insert('notificationFanOut', { tasksDueDay: today.key });
  return told;
}
