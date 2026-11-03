import { beforeEach, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { DAY_MS } from '../../convex/_lib/time';
import { logAudit } from '../../convex/lib/audit/log';
import { emitEvent } from '../../convex/lib/notifications/emit';
import { purgePage } from '../../convex/lib/retention/purge';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runDue,
  seedConfig,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 10, 2, 9, 0, 0);
beforeEach(() => pinClock(NOW));

// Running the scheduled work lands the fake clock on the real time: the sessions must outlive that.
const SESSION_TTL_MS = 365 * DAY_MS;

async function setup() {
  const t = createTestConvex();
  const lou = await seedEmployee(t, {
    email: 'lou@example.com',
    role: 'admin',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const camille = await seedEmployee(t, {
    email: 'camille@example.com',
    role: 'member',
    sessionTtlMs: SESSION_TTL_MS,
  });
  return {
    t,
    lou,
    camille,
    asLou: asIdentity(t, lou.identity),
    asCamille: asIdentity(t, camille.identity),
  };
}

/** Inbox rows written as the fan-out writes them, `i` minutes apart, the first the oldest. */
async function seedInbox(
  t: T,
  userId: Id<'users'>,
  count: number,
  opts: { readAt?: number; from?: number; deliveredAt?: number } = {},
): Promise<Id<'notifications'>[]> {
  return await t.run(async (ctx) => {
    const ids: Id<'notifications'>[] = [];
    for (let i = 0; i < count; i++) {
      const createdAt = (opts.from ?? NOW - count * 60_000) + i * 60_000;
      ids.push(
        await ctx.db.insert('notifications', {
          userId,
          kind: 'lead.assigned',
          title: `Lead ${i}`,
          body: 'Un lead.',
          path: '/leads',
          entity: { type: 'lead', id: `lead-${i}` },
          dedupeKey: `lead.assigned:lead-${i}:${userId}`,
          readAt: opts.readAt,
          createdAt,
          deliveredAt: opts.deliveredAt ?? createdAt,
        }),
      );
    }
    return ids;
  });
}

const inboxOf = (t: T, userId: Id<'users'>) =>
  t.run((ctx) =>
    ctx.db
      .query('notifications')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .collect(),
  );

const unreadOf = (t: T, userId: Id<'users'>) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query('notifications')
          .withIndex('by_user_unread', (q) => q.eq('userId', userId).eq('readAt', undefined))
          .collect()
      ).length,
  );

describe('the inbox', () => {
  test('the unread count stops at the cap, and a person sees their own rows only', async () => {
    const { t, lou, camille, asLou, asCamille } = await setup();
    await seedInbox(t, camille.userId, 101);
    await seedInbox(t, lou.userId, 2);
    expect(await asCamille.query(api.features.notifications.queries.unreadCount, {})).toBe(100);
    expect(await asLou.query(api.features.notifications.queries.unreadCount, {})).toBe(2);
  });

  test('the popover lists the unread first, newest first, then the most recently read, twenty in all', async () => {
    const { t, camille, asCamille } = await setup();
    await seedInbox(t, camille.userId, 5, { readAt: NOW - 1, from: NOW - DAY_MS });
    await seedInbox(t, camille.userId, 3);
    const latest = await asCamille.query(api.features.notifications.queries.latest, {});
    expect(latest.map((n) => n.title)).toEqual([
      'Lead 2',
      'Lead 1',
      'Lead 0',
      'Lead 4',
      'Lead 3',
      'Lead 2',
      'Lead 1',
      'Lead 0',
    ]);
    expect(latest.slice(0, 3).every((n) => n.readAt === undefined)).toBe(true);
    await seedInbox(t, camille.userId, 30, { from: NOW });
    expect(await asCamille.query(api.features.notifications.queries.latest, {})).toHaveLength(20);
  });

  test('the page walks the history by cursor, newest first, or the unread alone', async () => {
    const { t, camille, asCamille } = await setup();
    await seedInbox(t, camille.userId, 4, { readAt: NOW - 1, from: NOW - DAY_MS });
    await seedInbox(t, camille.userId, 3);
    const first = await asCamille.query(api.features.notifications.queries.listMine, {
      paginationOpts: { numItems: 5, cursor: null },
    });
    expect(first.page.map((n) => n.title)).toEqual([
      'Lead 2',
      'Lead 1',
      'Lead 0',
      'Lead 3',
      'Lead 2',
    ]);
    expect(first.isDone).toBe(false);
    const second = await asCamille.query(api.features.notifications.queries.listMine, {
      paginationOpts: { numItems: 5, cursor: first.continueCursor },
    });
    expect(second.page.map((n) => n.title)).toEqual(['Lead 1', 'Lead 0']);
    expect(second.isDone).toBe(true);
    const unread = await asCamille.query(api.features.notifications.queries.listMine, {
      paginationOpts: { numItems: 10, cursor: null },
      unreadOnly: true,
    });
    expect(unread.page).toHaveLength(3);
  });

  test('opening a notification reads it; someone else’s is not there', async () => {
    const { t, lou, camille, asLou, asCamille } = await setup();
    const [mine] = await seedInbox(t, camille.userId, 1);
    const [theirs] = await seedInbox(t, lou.userId, 1);
    await asCamille.mutation(api.features.notifications.mutations.markRead, {
      notificationId: mine!,
    });
    expect((await t.run((ctx) => ctx.db.get(mine!)))?.readAt).toBe(NOW);
    await expect(
      asCamille.mutation(api.features.notifications.mutations.markRead, {
        notificationId: theirs!,
      }),
    ).rejects.toMatchObject({ data: { code: 'notification_not_found' } });
    expect((await t.run((ctx) => ctx.db.get(theirs!)))?.readAt).toBeUndefined();
    // Reading it again changes nothing.
    await asCamille.mutation(api.features.notifications.mutations.markRead, {
      notificationId: mine!,
    });
    expect((await t.run((ctx) => ctx.db.get(mine!)))?.readAt).toBe(NOW);
    expect(await unreadOf(t, lou.userId)).toBe(1);
    void asLou;
  });

  test('« tout marquer comme lu » reads what was unread at the click, in scheduled batches, and nothing that came after', async () => {
    const { t, lou, camille, asCamille } = await setup();
    await seedInbox(t, camille.userId, 450, { from: NOW - 450 * 60_000 });
    await seedInbox(t, lou.userId, 1);
    await asCamille.mutation(api.features.notifications.mutations.markAllRead, {});
    // Arrived after the click: stays unread.
    await seedInbox(t, camille.userId, 1, { from: NOW + 60_000 });
    await runDue(t);
    expect(await unreadOf(t, camille.userId)).toBe(1);
    expect(await unreadOf(t, lou.userId)).toBe(1);
  });

  test('a fact delivered after the click stays unread, however old the fact is', async () => {
    const { t, lou, camille, asCamille } = await setup();
    await seedInbox(t, camille.userId, 1);
    // A fact from before the click, still waiting for its fan-out.
    const leadId = await seedLead(t, { email: 'late@example.com' });
    await t.run((ctx) =>
      emitEvent(ctx, {
        kind: 'lead.assigned',
        entity: { type: 'lead', id: leadId },
        actorId: lou.userId,
        data: { assigned: [camille.userId] },
      }),
    );
    await asCamille.mutation(api.features.notifications.mutations.markAllRead, {});
    // The fan-out, scheduled first, delivers a moment later (running the timers moves the clock on); the batch then reads only what was there at the click.
    await runDue(t);
    const rows = await inboxOf(t, camille.userId);
    expect(rows.map((r) => [r.kind, r.readAt === undefined])).toEqual([
      ['lead.assigned', false],
      ['lead.assigned', true],
    ]);
    // The fact's time is the click's or before; the delivery came after it.
    expect(rows[1]!.createdAt).toBe(NOW);
    expect(rows[1]!.deliveredAt).toBeGreaterThan(NOW);
  });

  test('the purge drops the notifications and their deliveries past their own duration, read or not', async () => {
    const { t, camille } = await setup();
    await seedConfig(t, { retention: { notificationDays: 30 } });
    const [old] = await seedInbox(t, camille.userId, 1, { from: NOW - 31 * DAY_MS });
    const [oldRead] = await seedInbox(t, camille.userId, 1, {
      from: NOW - 40 * DAY_MS,
      readAt: NOW - 39 * DAY_MS,
    });
    const [fresh] = await seedInbox(t, camille.userId, 1, { from: NOW - 29 * DAY_MS });
    await t.run((ctx) =>
      ctx.db.insert('notificationDeliveries', {
        notificationId: old!,
        channel: 'email',
        status: 'sent',
        attempts: 1,
        nextAt: NOW - 31 * DAY_MS,
        createdAt: NOW - 31 * DAY_MS,
      }),
    );
    const policy = {
      softDeleteDays: 30,
      eventDays: 365,
      auditDays: 730,
      notificationDays: 30,
      trackingDays: 90,
    };
    const page = await t.run((ctx) => purgePage(ctx, policy, NOW));
    expect(page.counts.notifications).toBe(2);
    expect(page.counts.notificationDeliveries).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(old!))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(oldRead!))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(fresh!))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.query('notificationDeliveries').collect())).toEqual([]);
  });

  test('the duration is a setting, within its bounds', async () => {
    const { t, asLou } = await setup();
    await seedConfig(t);
    await asLou.mutation(api.features.config.mutations.updateConfig, {
      retentionNotificationDays: 14,
    });
    const config = await asLou.query(api.features.config.queries.getAdminConfig, {});
    expect(config?.retention).toMatchObject({ notificationDays: 14, auditDays: 730 });
    await expect(
      asLou.mutation(api.features.config.mutations.updateConfig, { retentionNotificationDays: 3 }),
    ).rejects.toMatchObject({
      data: { code: 'retention_out_of_bounds', reason: 'notificationDays' },
    });
  });

  test('an accepted invitation is told to the settings right, off by default, never to the person who joined', async () => {
    const { t, lou, camille } = await setup();
    const joined = await seedEmployee(t, { email: 'new@example.com', role: 'member' });
    await t.run(async (ctx) => {
      const invitationId = await ctx.db.insert('invitations', {
        email: 'new@example.com',
        role: 'member',
        status: 'accepted',
        invitedBy: lou.userId,
        invitedAt: NOW - DAY_MS,
        acceptedAt: NOW,
      });
      // What the acceptance hook writes once the employee exists.
      await logAudit({
        ctx,
        userId: joined.userId,
        entityType: 'invitation',
        entityId: invitationId,
        action: 'update',
        metadata: { email: 'new@example.com', role: 'member', event: 'accepted' },
      });
    });
    const fact = await t.run((ctx) => ctx.db.query('notificationEvents').first());
    expect(fact).toMatchObject({
      kind: 'team.invitation_accepted',
      actorId: joined.userId,
      data: { email: 'new@example.com', role: 'member' },
    });
    await runDue(t);
    // The kind is off by default: nobody is told until preferences exist (#171).
    expect(await unreadOf(t, lou.userId)).toBe(0);
    expect(await unreadOf(t, camille.userId)).toBe(0);
    expect(await unreadOf(t, joined.userId)).toBe(0);
  });
});
