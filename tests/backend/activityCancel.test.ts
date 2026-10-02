import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const T0 = Date.parse('2026-03-02T09:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// The day and the week around T0, as the browser sends them.
const BOUNDS = {
  startOfToday: T0 - 9 * HOUR,
  endOfToday: T0 - 9 * HOUR + DAY,
  endOfWeek: T0 - 9 * HOUR + 7 * DAY,
};

async function setup() {
  pinClock(T0);
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'ada@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  const leadId = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Claire',
    lastName: 'Fontaine',
    ownerIds: [emp.userId],
  });
  const activityId = await as.mutation(api.features.activities.mutations.createActivity, {
    type: 'task',
    title: 'Envoyer le devis',
    leadId,
    dueAt: T0 + HOUR,
  });
  return { t, emp, as, leadId, activityId };
}
type As = ReturnType<typeof asIdentity>;

const activityOf = async (t: T, activityId: Id<'activities'>) =>
  (await t.run((ctx) => ctx.db.get(activityId)))!;

const auditOf = (t: T, activityId: Id<'activities'>) =>
  t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .withIndex('by_entity', (q) => q.eq('entityType', 'activity').eq('entityId', activityId))
      .collect(),
  );

const dueToday = async (as: As) =>
  (await as.query(api.features.activities.queries.countTaskBuckets, BOUNDS)).today;

const cancel = (as: As, activityId: Id<'activities'>) =>
  as.mutation(api.features.activities.mutations.cancelActivity, { activityId });

describe('activity cancellation', () => {
  test('cancelling an open task takes it out of the open counters and audits the change', async () => {
    const { t, as, emp, activityId } = await setup();
    expect(await dueToday(as)).toBe(1);

    pinClock(T0 + HOUR / 2);
    expect(await cancel(as, activityId)).toBeNull();

    const activity = await activityOf(t, activityId);
    expect(activity).toMatchObject({
      status: 'cancelled',
      updatedAt: T0 + HOUR / 2,
      updatedBy: emp.userId,
    });
    expect(activity.completedAt).toBeUndefined();
    expect(await dueToday(as)).toBe(0);
    const cancelled = await as.query(api.features.activities.queries.listTasks, {
      status: 'cancelled',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(cancelled.page.map((a) => a._id)).toEqual([activityId]);

    const audit = await auditOf(t, activityId);
    expect(audit.map((a) => a.action)).toEqual(['create', 'update']);
    expect(audit[1]).toMatchObject({
      userId: emp.userId,
      timestamp: T0 + HOUR / 2,
      metadata: { changes: { status: { old: 'open', new: 'cancelled' } } },
    });
  });

  test('cancelling an activity already cancelled changes nothing', async () => {
    const { t, as, activityId } = await setup();
    await cancel(as, activityId);

    pinClock(T0 + HOUR / 2);
    expect(await cancel(as, activityId)).toBeNull();

    expect((await activityOf(t, activityId)).updatedAt).toBe(T0);
    expect((await auditOf(t, activityId)).map((a) => a.action)).toEqual(['create', 'update']);
  });

  test('a done activity can be cancelled, and a cancelled one reopened', async () => {
    const { t, as, activityId } = await setup();
    await as.mutation(api.features.activities.mutations.completeActivity, {
      activityId,
      outcome: 'Devis envoyé',
    });

    expect(await cancel(as, activityId)).toBeNull();
    expect(await activityOf(t, activityId)).toMatchObject({
      status: 'cancelled',
      outcome: 'Devis envoyé',
    });
    expect((await auditOf(t, activityId)).at(-1)?.metadata).toEqual({
      changes: { status: { old: 'done', new: 'cancelled' } },
    });
    expect(await dueToday(as)).toBe(0);

    await as.mutation(api.features.activities.mutations.reopenActivity, { activityId });
    expect((await activityOf(t, activityId)).status).toBe('open');
    expect(await dueToday(as)).toBe(1);
  });

  test('a deleted activity cannot be cancelled', async () => {
    const { t, as, activityId } = await setup();
    await as.mutation(api.features.activities.mutations.deleteActivity, { activityId });

    await expect(cancel(as, activityId)).rejects.toThrow('activity_not_found');
    expect((await activityOf(t, activityId)).status).toBe('open');
  });

  test('a visitor without session cannot cancel', async () => {
    const { t, activityId } = await setup();
    await expect(
      t.mutation(api.features.activities.mutations.cancelActivity, { activityId }),
    ).rejects.toThrow('Unauthenticated');
    expect((await activityOf(t, activityId)).status).toBe('open');
  });
});
