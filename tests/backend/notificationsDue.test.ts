import { beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { uniformAccess } from '../../convex/_lib/validators/access';
import { zonedDayOf } from '../../convex/lib/shared/zonedTime';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runDue,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

// The organisation is in Los Angeles: its day is eight hours behind the clock's, and the fact is told at 08:00 there.
const TZ = 'America/Los_Angeles';
/** 2026-11-12 08:00 in Los Angeles (standard time since the first of the month). */
const EIGHT = Date.UTC(2026, 10, 12, 16, 0, 0);
const HOUR = 60 * 60 * 1000;
const SESSION_TTL_MS = 365 * 24 * HOUR;

beforeEach(() => {
  pinClock(EIGHT);
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
});

async function setup(config: { timezone?: string; tasksDueHour?: number } = { timezone: TZ }) {
  const t = createTestConvex();
  const lou = await seedEmployee(t, {
    email: 'lou.due@example.com',
    role: 'admin',
    firstName: 'Lou',
    lastName: 'Martin',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const camille = await seedEmployee(t, {
    email: 'camille.due@example.com',
    role: 'member',
    firstName: 'Camille',
    lastName: 'Roux',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const sam = await seedEmployee(t, {
    email: 'sam.due@example.com',
    role: 'member',
    firstName: 'Sam',
    lastName: 'Petit',
    sessionTtlMs: SESSION_TTL_MS,
  });
  await seedConfig(t, config);
  return { t, lou, camille, sam, asLou: asIdentity(t, lou.identity) };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** Lou plans a task for someone, due at an instant. */
const plan = (ctx: Ctx, title: string, ownerId: Id<'users'> | null, dueAt?: number) =>
  ctx.asLou.mutation(api.features.activities.mutations.createActivity, {
    type: 'task',
    title,
    ownerId,
    dueAt,
  });

/** The engine's state row, where the day told of is written down. */
const stateOf = (t: T) => t.run((ctx) => ctx.db.query('notificationFanOut').first());

/** The cron's run at the instant, then the fan-out it queued. */
async function strike(t: T, at: number): Promise<number> {
  pinClock(at);
  const told = await t.mutation(internal.features.notifications.internal.tellTasksDue, {});
  await runDue(t);
  return told;
}

const inboxOf = (t: T, userId: Id<'users'>) =>
  t.run((ctx) =>
    ctx.db
      .query('notifications')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .collect(),
  );

describe('the day of an organisation', () => {
  test('is read in its time zone: its key, the hour its clock shows, and its bounds, across a change of offset', () => {
    // 2026-11-12 16:00 UTC is 08:00 in Los Angeles; the day runs from 08:00 UTC to 08:00 UTC the next day.
    expect(zonedDayOf(EIGHT, TZ)).toEqual({
      key: '2026-11-12',
      hour: 8,
      start: Date.UTC(2026, 10, 12, 8),
      end: Date.UTC(2026, 10, 13, 8),
    });
    // 23:30 in Paris on the 12th is the 12th there, the 13th by the clock's calendar? No: 22:30 UTC, still the 12th. 00:30 Paris is the 13th.
    expect(zonedDayOf(Date.UTC(2026, 10, 12, 23, 30), 'Europe/Paris')).toMatchObject({
      key: '2026-11-13',
      hour: 0,
      start: Date.UTC(2026, 10, 12, 23),
      end: Date.UTC(2026, 10, 13, 23),
    });
    // The day Paris leaves summer time has twenty-five hours.
    const long = zonedDayOf(Date.UTC(2026, 9, 25, 12), 'Europe/Paris');
    expect(long).toMatchObject({ key: '2026-10-25', start: Date.UTC(2026, 9, 24, 22) });
    expect(long.end - long.start).toBe(25 * HOUR);
    // Kolkata is thirty minutes off the hour: its clock still shows a whole hour.
    expect(zonedDayOf(Date.UTC(2026, 10, 12, 2, 30), 'Asia/Kolkata')).toMatchObject({
      key: '2026-11-12',
      hour: 8,
    });
  });
});

describe('« vos tâches à faire aujourd’hui »', () => {
  test('at the organisation’s hour, tells each person how many open tasks fall due that day in its time zone, names the first ones, and opens the day’s tasks; a person with none hears nothing', async () => {
    const ctx = await setup();
    const { t, camille, sam, lou } = ctx;
    // Camille's three: the first minutes of the day there, noon, and its last hour (the next day by UTC).
    await plan(ctx, 'Rappeler le cabinet', camille.userId, Date.UTC(2026, 10, 12, 8, 30));
    await plan(ctx, 'Devis Dupont', camille.userId, Date.UTC(2026, 10, 12, 20));
    await plan(ctx, 'Relancer Martin', camille.userId, Date.UTC(2026, 10, 13, 7));
    // Not today there: 23:00 the day before (though the 12th by UTC), tomorrow, no date.
    await plan(ctx, 'Hier soir', camille.userId, Date.UTC(2026, 10, 12, 7));
    await plan(ctx, 'Demain', camille.userId, Date.UTC(2026, 10, 13, 9));
    await plan(ctx, 'Un jour', camille.userId);
    // Not open any more.
    const done = await plan(ctx, 'Faite', camille.userId, Date.UTC(2026, 10, 12, 18));
    await ctx.asLou.mutation(api.features.activities.mutations.completeActivity, {
      activityId: done,
    });
    const gone = await plan(ctx, 'Supprimée', camille.userId, Date.UTC(2026, 10, 12, 18));
    await ctx.asLou.mutation(api.features.activities.mutations.deleteActivity, {
      activityId: gone,
    });
    // Sam's one, and one of nobody's.
    await plan(ctx, 'Appeler Sam', sam.userId, Date.UTC(2026, 10, 12, 17));
    await plan(ctx, 'Sans responsable', null, Date.UTC(2026, 10, 12, 17));
    await runDue(t);
    await t.run(async (c) => {
      for (const row of await c.db.query('notifications').collect()) await c.db.delete(row._id);
    });

    expect(await strike(t, EIGHT)).toBe(2);
    expect(await inboxOf(t, camille.userId)).toMatchObject([
      {
        kind: 'activity.due',
        entity: { type: 'day', id: '2026-11-12' },
        dedupeKey: `activity.due:2026-11-12:${camille.userId}`,
        title: '3 tâches à faire aujourd’hui',
        body: 'Rappeler le cabinet, Devis Dupont et Relancer Martin.',
        path: '/tasks',
      },
    ]);
    expect(await inboxOf(t, sam.userId)).toMatchObject([
      { title: '1 tâche à faire aujourd’hui', body: 'Appeler Sam.' },
    ]);
    expect(await inboxOf(t, lou.userId)).toEqual([]);
  });

  test('names three titles then counts the rest', async () => {
    const ctx = await setup();
    for (const title of ['Une', 'Deux', 'Trois', 'Quatre', 'Cinq']) {
      await plan(ctx, title, ctx.camille.userId, Date.UTC(2026, 10, 12, 18));
    }
    await runDue(ctx.t);
    await strike(ctx.t, EIGHT);
    expect((await inboxOf(ctx.t, ctx.camille.userId)).at(-1)).toMatchObject({
      title: '5 tâches à faire aujourd’hui',
      body: 'Une, Deux, Trois et 2 autres.',
    });
  });

  test('is told once a day, from the first run at or after the hour: a run before it, a run again, a run after the row was read, a task planned later that day add nothing; the next day has its own', async () => {
    const ctx = await setup();
    const { t, camille, sam } = ctx;
    const asCamille = asIdentity(t, camille.identity);
    await plan(ctx, 'Aujourd’hui', camille.userId, Date.UTC(2026, 10, 12, 18));
    await plan(ctx, 'Demain', camille.userId, Date.UTC(2026, 10, 13, 18));
    await runDue(t);
    expect(await strike(t, EIGHT - HOUR)).toBe(0);
    expect((await stateOf(t))?.tasksDueDay).toBeUndefined();
    expect(await strike(t, EIGHT)).toBe(1);
    expect(await stateOf(t)).toMatchObject({ tasksDueDay: '2026-11-12' });
    expect(await strike(t, EIGHT)).toBe(0);
    // Read, then the run repeats: still nothing.
    const [row] = (await inboxOf(t, camille.userId)).filter((n) => n.kind === 'activity.due');
    await asCamille.mutation(api.features.notifications.mutations.markRead, {
      notificationId: row!._id,
    });
    expect(await strike(t, EIGHT + 30 * 60 * 1000)).toBe(0);
    // A task planned for today after the reminder waits for tomorrow's page, not a second reminder.
    pinClock(EIGHT + 2 * HOUR);
    await plan(ctx, 'Pour Sam', sam.userId, Date.UTC(2026, 10, 12, 23));
    await runDue(t);
    expect(await strike(t, EIGHT + 3 * HOUR)).toBe(0);
    expect((await inboxOf(t, sam.userId)).filter((n) => n.kind === 'activity.due')).toEqual([]);
    // The next morning: the task of the day before is overdue, not due today; tomorrow's is.
    expect(await strike(t, EIGHT + 24 * HOUR)).toBe(1);
    const due = (await inboxOf(t, camille.userId)).filter((n) => n.kind === 'activity.due');
    expect(due.map((n) => [n.entity.id, n.body])).toEqual([
      ['2026-11-12', 'Aujourd’hui.'],
      ['2026-11-13', 'Demain.'],
    ]);
  });

  test('a run that missed the hour tells at the next: a deployment down at 08:00 reminds at 11:00', async () => {
    const ctx = await setup();
    await plan(ctx, 'Aujourd’hui', ctx.camille.userId, Date.UTC(2026, 10, 12, 18));
    await runDue(ctx.t);
    expect(await strike(ctx.t, EIGHT + 3 * HOUR)).toBe(1);
  });

  test('a zone thirty minutes off the hour is told on the hour, and a day without the hour, when clocks go forward, at the next; a day with it twice, when they go back, once', async () => {
    // Kolkata, 08:00 is 02:30 UTC.
    const kolkata = await setup({ timezone: 'Asia/Kolkata' });
    await plan(kolkata, 'Ce matin', kolkata.camille.userId, Date.UTC(2026, 10, 12, 6));
    await runDue(kolkata.t);
    expect(await strike(kolkata.t, Date.UTC(2026, 10, 12, 2, 0))).toBe(0);
    expect(await strike(kolkata.t, Date.UTC(2026, 10, 12, 2, 30))).toBe(1);

    // Paris at 02:00: on 2027-03-28 the clock goes from 02:00 to 03:00 at 01:00 UTC.
    const forward = await setup({ timezone: 'Europe/Paris', tasksDueHour: 2 });
    await plan(forward, 'Dimanche', forward.camille.userId, Date.UTC(2027, 2, 28, 10));
    await runDue(forward.t);
    expect(await strike(forward.t, Date.UTC(2027, 2, 28, 0, 30))).toBe(0);
    expect(await strike(forward.t, Date.UTC(2027, 2, 28, 1, 0))).toBe(1);
    expect((await stateOf(forward.t))?.tasksDueDay).toBe('2027-03-28');

    // On 2026-10-25 the clock shows 02:00 at 00:00 UTC and again at 01:00 UTC.
    const back = await setup({ timezone: 'Europe/Paris', tasksDueHour: 2 });
    await plan(back, 'Dimanche', back.camille.userId, Date.UTC(2026, 9, 25, 10));
    await runDue(back.t);
    expect(await strike(back.t, Date.UTC(2026, 9, 25, 0, 0))).toBe(1);
    expect(await strike(back.t, Date.UTC(2026, 9, 25, 1, 0))).toBe(0);
  });

  test('a person whose role has no activities module is not reminded of what they cannot open', async () => {
    const ctx = await setup();
    const { t, camille, sam, asLou } = ctx;
    const support = await asLou.mutation(api.features.roles.mutations.createRole, {
      label: 'Support',
      access: { ...uniformAccess('own', false), activities: 'none' },
    });
    await asLou.mutation(api.features.users.mutations.setEmployeeRole, {
      userId: camille.userId,
      role: support,
    });
    await plan(ctx, 'Héritée', camille.userId, Date.UTC(2026, 10, 12, 18));
    await plan(ctx, 'La sienne', sam.userId, Date.UTC(2026, 10, 12, 18));
    await runDue(t);
    expect(await strike(t, EIGHT)).toBe(1);
    expect((await inboxOf(t, camille.userId)).filter((n) => n.kind === 'activity.due')).toEqual([]);
    expect((await inboxOf(t, sam.userId)).filter((n) => n.kind === 'activity.due')).toHaveLength(1);
  });

  test('follows the hour the settings right chooses, 08:00 until set, between 0 and 23; the kind is the person’s to turn off', async () => {
    const ctx = await setup();
    const { t, camille, asLou } = ctx;
    await plan(ctx, 'Aujourd’hui', camille.userId, Date.UTC(2026, 10, 12, 18));
    await runDue(t);
    expect((await asLou.query(api.features.config.queries.getAdminConfig, {}))?.tasksDueHour).toBe(
      8,
    );
    for (const tasksDueHour of [24, -1, 8.5]) {
      await expect(
        asLou.mutation(api.features.config.mutations.updateConfig, { tasksDueHour }),
      ).rejects.toMatchObject({ data: { code: 'invalid_tasks_due_hour' } });
    }
    await asLou.mutation(api.features.config.mutations.updateConfig, { tasksDueHour: 9 });
    expect((await asLou.query(api.features.config.queries.getAdminConfig, {}))?.tasksDueHour).toBe(
      9,
    );
    expect(await strike(t, EIGHT)).toBe(0);
    expect(await strike(t, EIGHT + HOUR)).toBe(1);

    // Turned off by the person: the fact is written, the fan-out writes nothing for them.
    await asIdentity(t, camille.identity).mutation(
      api.features.notifications.mutations.updateMyNotificationPreferences,
      { kinds: { 'activity.due': false } },
    );
    await plan(ctx, 'Demain', camille.userId, Date.UTC(2026, 10, 13, 18));
    await runDue(t);
    expect(await strike(t, EIGHT + 25 * HOUR)).toBe(1);
    expect(
      (await inboxOf(t, camille.userId)).filter((n) => n.kind === 'activity.due'),
    ).toHaveLength(1);
  });

  test('a deployment without a time zone set reads Paris', async () => {
    const ctx = await setup({});
    await plan(ctx, 'Ce matin', ctx.camille.userId, Date.UTC(2026, 10, 12, 10));
    await runDue(ctx.t);
    // 08:00 in Paris is 07:00 UTC in November.
    expect(await strike(ctx.t, Date.UTC(2026, 10, 12, 7))).toBe(1);
  });
});
