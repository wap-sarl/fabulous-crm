import { beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
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

  test('is told once a day: the cron run again, even after the row was read, adds nothing; the next day has its own', async () => {
    const ctx = await setup();
    const { t, camille } = ctx;
    const asCamille = asIdentity(t, camille.identity);
    await plan(ctx, 'Aujourd’hui', camille.userId, Date.UTC(2026, 10, 12, 18));
    await plan(ctx, 'Demain', camille.userId, Date.UTC(2026, 10, 13, 18));
    await runDue(t);
    expect(await strike(t, EIGHT)).toBe(1);
    expect(await strike(t, EIGHT)).toBe(0);
    // Read, then the run repeats within the hour: still nothing.
    const [row] = (await inboxOf(t, camille.userId)).filter((n) => n.kind === 'activity.due');
    await asCamille.mutation(api.features.notifications.mutations.markRead, {
      notificationId: row!._id,
    });
    expect(await strike(t, EIGHT + 5 * 60 * 1000)).toBe(0);
    // Not at another hour either.
    expect(await strike(t, EIGHT + HOUR)).toBe(0);
    expect(await strike(t, EIGHT - HOUR)).toBe(0);
    // The next morning: the task of the day before is overdue, not due today; tomorrow's is.
    expect(await strike(t, EIGHT + 24 * HOUR)).toBe(1);
    const due = (await inboxOf(t, camille.userId)).filter((n) => n.kind === 'activity.due');
    expect(due.map((n) => [n.entity.id, n.body])).toEqual([
      ['2026-11-12', 'Aujourd’hui.'],
      ['2026-11-13', 'Demain.'],
    ]);
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
