import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import { DAY_MS } from '../../convex/_lib/time';
import { emptyCounts } from '../../convex/lib/retention/budget';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runAll,
  seedConfig,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.parse('2026-09-22T03:30:00Z');
const DEFAULT_POLICY = { softDeleteDays: 30, eventDays: 365, auditDays: 730, trackingDays: 90 };
beforeEach(() => {
  pinClock(NOW);
});

async function setup() {
  const t = createTestConvex();
  // A session that outlives the nights the tests go through.
  const admin = await seedEmployee(t, {
    email: 'admin@example.com',
    role: 'admin',
    sessionTtlMs: 7 * DAY_MS,
  });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  await seedConfig(t, { updatedAt: NOW });
  return { t, as: asIdentity(t, admin.identity), asMember: asIdentity(t, member.identity) };
}

/** One nightly run at `at`, its continuation pages included; running timers moves the date, so it goes back. */
async function purge(t: T, at: number) {
  jest.setSystemTime(new Date(at));
  await t.mutation(internal.features.retention.internal.runPurge, {});
  await runAll(t, at);
}

/** A contact in the trash for `days` days, and an invitation expired since yesterday. */
async function seedExpired(t: T, at: number, days: number, tag: string) {
  const leadId = await seedLead(t, { email: `trash-${tag}@example.com` });
  await t.run(async (ctx) => {
    await ctx.db.patch(leadId, { deletedAt: at - days * DAY_MS });
    await ctx.db.insert('invitations', {
      email: `expired-${tag}@example.com`,
      role: 'member',
      status: 'pending',
      invitedAt: at - 10 * DAY_MS,
      expiresAt: at - DAY_MS,
    });
  });
  return leadId;
}

describe('the last purge, for the settings page', () => {
  test('is null before the first run', async () => {
    const { as } = await setup();
    expect(await as.query(api.features.retention.queries.lastPurge, {})).toBeNull();
  });

  test('a run that found nothing still reports itself, with every count at zero', async () => {
    const { t, as } = await setup();
    await purge(t, NOW);
    expect(await as.query(api.features.retention.queries.lastPurge, {})).toEqual({
      at: NOW,
      report: {
        startedAt: NOW,
        finishedAt: NOW,
        pages: 1,
        truncated: false,
        policy: DEFAULT_POLICY,
        counts: emptyCounts(),
      },
    });
  });

  test('carries the date of the run, its policy and what it removed', async () => {
    const { t, as } = await setup();
    const leadId = await seedExpired(t, NOW, 31, 'a');
    await purge(t, NOW);

    expect(await t.run((ctx) => ctx.db.get(leadId))).toBeNull();
    expect(await as.query(api.features.retention.queries.lastPurge, {})).toEqual({
      at: NOW,
      report: {
        startedAt: NOW,
        finishedAt: NOW,
        pages: 1,
        truncated: false,
        policy: DEFAULT_POLICY,
        counts: { ...emptyCounts(), leads: 1, invitations: 1 },
      },
    });
  });

  test('is the most recent of several runs, under the policy of its night', async () => {
    const { t, as } = await setup();
    await seedExpired(t, NOW, 31, 'a');
    await purge(t, NOW);
    await as.mutation(api.features.config.mutations.updateConfig, { retentionSoftDeleteDays: 5 });
    const tomorrow = NOW + DAY_MS;
    await seedExpired(t, tomorrow, 7, 'b');
    await seedLead(t, { email: 'trash-c@example.com', deletedAt: tomorrow - 6 * DAY_MS });
    await purge(t, tomorrow);

    expect(await as.query(api.features.retention.queries.lastPurge, {})).toEqual({
      at: tomorrow,
      report: {
        startedAt: tomorrow,
        finishedAt: tomorrow,
        pages: 1,
        truncated: false,
        policy: { ...DEFAULT_POLICY, softDeleteDays: 5 },
        counts: { ...emptyCounts(), leads: 2, invitations: 1 },
      },
    });
  });

  test('a run of several pages reports the sum of its pages, from its first to its last', async () => {
    const { t, as } = await setup();
    await seedExpired(t, NOW, 31, 'a');
    // The last page of a run started a minute ago, as the scheduler hands it over.
    await t.mutation(internal.features.retention.internal.runPurge, {
      startedAt: NOW - 60_000,
      page: 3,
      counts: { ...emptyCounts(), leads: 40, related: 3900, auditLogs: 12 },
      policy: DEFAULT_POLICY,
    });
    await runAll(t, NOW);

    expect(await as.query(api.features.retention.queries.lastPurge, {})).toEqual({
      at: NOW,
      report: {
        startedAt: NOW - 60_000,
        finishedAt: NOW,
        pages: 3,
        truncated: false,
        policy: DEFAULT_POLICY,
        counts: { ...emptyCounts(), leads: 41, related: 3900, invitations: 1, auditLogs: 12 },
      },
    });
  });

  test('is refused without the settings access', async () => {
    const { t, asMember } = await setup();
    await purge(t, NOW);
    await expect(asMember.query(api.features.retention.queries.lastPurge, {})).rejects.toThrow(
      'Unauthorized: settings access',
    );
  });
});
