import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { readCampaignStats } from '../../convex/lib/campaigns/stats';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);
const HOUR = 3_600_000;
const fn = internal.features.campaigns.internal;

type World = { t: T; as: ReturnType<typeof asIdentity>; userId: Id<'users'> };

let savedKey: string | undefined;
beforeEach(() => {
  pinClock(NOW);
  savedKey = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = 'test-brevo-key';
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = savedKey;
});

async function setup(leads = 3, withoutEmail = 0): Promise<World> {
  const t = createTestConvex();
  // The clock moves by a day in one test: the session must outlive it.
  const emp = await seedEmployee(t, {
    email: 'agent@example.com',
    role: 'admin',
    sessionTtlMs: 3 * 24 * HOUR,
  });
  await seedConfig(t);
  const as = asIdentity(t, emp.identity);
  for (let i = 0; i < withoutEmail; i++) {
    await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Sans',
      lastName: `E${i}`,
      email: '',
    });
  }
  for (let i = 0; i < leads; i++) {
    await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Jean',
      lastName: `N${i}`,
      email: `lead${i}@example.com`,
    });
  }
  return { t, as, userId: emp.userId };
}

const create = (w: World) =>
  w.as.mutation(api.features.campaigns.mutations.createCampaign, {
    name: 'Relance',
    channel: 'email',
    filter: {},
    subject: 'Bonjour',
    htmlBody: '<p>Bonjour</p>',
    messageType: 'transactional',
  });

const get = (w: World, id: Id<'campaigns'>) =>
  w.t.run(async (ctx) => (await ctx.db.get(id)) as Doc<'campaigns'>);

const sendsOf = (w: World, id: Id<'campaigns'>) =>
  w.t.run((ctx) =>
    ctx.db
      .query('campaignSends')
      .withIndex('by_campaign', (q) => q.eq('campaignId', id))
      .collect(),
  );

/** The scheduled calls, by the name of their function, with their state. */
const jobs = (w: World, name: string) =>
  w.t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.name.includes(name))
      .map((job) => ({ state: job.state.kind, args: job.args[0] as Record<string, unknown> })),
  );

const jobState = (w: World, id: Id<'_scheduled_functions'> | undefined) =>
  w.t.run(async (ctx) => (id ? (await ctx.db.system.get(id))?.state.kind : undefined));

describe('stopping a campaign', () => {
  test('while it sends: nothing more leaves, the queued sends are cancelled a page at a time and count as skipped, the drain ends on its own; a retry or a resend re-queues them', async () => {
    // One lead without an e-mail: a skipped send, counted among the failures from the start.
    const w = await setup(3, 1);
    const campaignId = await create(w);
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    let campaign = await get(w, campaignId);
    expect(campaign).toMatchObject({ status: 'sending', totalCount: 4, failedCount: 1 });
    // The drain's call is on record.
    expect(await jobState(w, campaign.drainFnId)).toBe('pending');
    const first = (await sendsOf(w, campaignId)).find((s) => s.status === 'pending')!;
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: [{ sendId: first._id, status: 'sent', brevoMessageId: 'm-1' }],
    });

    await w.as.mutation(api.features.campaigns.mutations.stopCampaignSending, { campaignId });
    campaign = await get(w, campaignId);
    expect(campaign).toMatchObject({ status: 'stopped', sentCount: 1, failedCount: 1 });
    expect(campaign.drainFnId).toBeUndefined();
    // The drain finds nothing and completes nothing: the campaign keeps its word.
    expect(await w.t.query(fn.getPendingSends, { campaignId })).toBeNull();
    await w.t.mutation(fn.markCampaignComplete, { campaignId });
    expect((await get(w, campaignId)).status).toBe('stopped');

    expect(await jobs(w, 'cancelPendingSends')).toEqual([
      { state: 'pending', args: { campaignId } },
    ]);
    expect(await w.t.mutation(fn.cancelPendingSends, { campaignId, batchSize: 1 })).toEqual({
      cancelled: 1,
      isDone: false,
    });
    expect(await w.t.mutation(fn.cancelPendingSends, { campaignId, batchSize: 1 })).toEqual({
      cancelled: 1,
      isDone: false,
    });
    expect(await w.t.mutation(fn.cancelPendingSends, { campaignId, batchSize: 1 })).toEqual({
      cancelled: 0,
      isDone: true,
    });
    const sends = await sendsOf(w, campaignId);
    expect(sends.map((s) => s.status).sort()).toEqual([
      'cancelled',
      'cancelled',
      'sent',
      'skipped_no_email',
    ]);
    expect(await w.t.run((ctx) => readCampaignStats(ctx, campaignId))).toMatchObject({
      pending: 0,
      skipped: 3,
    });
    const events = await w.t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect())
        .map((a) => (a.metadata as { event?: string } | undefined)?.event)
        .filter((event): event is string => event !== undefined),
    );
    expect(events).toEqual(['stopped']);

    // A cancelled send is re-queued by a retry, the counters untouched since it was counted in neither.
    const cancelled = sends.find((s) => s.status === 'cancelled')!;
    await w.as.mutation(api.features.campaigns.mutations.retryCampaignSend, {
      campaignId,
      sendId: cancelled._id,
    });
    campaign = await get(w, campaignId);
    expect(campaign).toMatchObject({ status: 'sending', sentCount: 1, failedCount: 1 });
    expect(await jobState(w, campaign.drainFnId)).toBe('pending');
    expect((await w.t.run((ctx) => ctx.db.get(cancelled._id)))?.status).toBe('pending');

    // A resend of all from a stopped campaign.
    await w.as.mutation(api.features.campaigns.mutations.stopCampaignSending, { campaignId });
    await w.t.mutation(fn.cancelPendingSends, { campaignId });
    await w.as.mutation(api.features.campaigns.mutations.resendAllCampaignSends, { campaignId });
    expect((await get(w, campaignId)).status).toBe('preparing');
    // The cancel chain of the first stop, were it still to run, leaves a resend alone.
    expect(await w.t.mutation(fn.cancelPendingSends, { campaignId })).toEqual({
      cancelled: 0,
      isDone: true,
    });
  });

  test('resuming re-queues the cancelled sends and nothing else: the ones already sent stay sent and counted, the drain follows the last page', async () => {
    const w = await setup(4);
    const campaignId = await create(w);
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const [first, second] = await sendsOf(w, campaignId);
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: [
        { sendId: first._id, status: 'sent', brevoMessageId: 'm-1' },
        { sendId: second._id, status: 'failed', error: 'boom' },
      ],
    });
    await w.as.mutation(api.features.campaigns.mutations.stopCampaignSending, { campaignId });
    await w.t.mutation(fn.cancelPendingSends, { campaignId });
    expect((await sendsOf(w, campaignId)).map((s) => s.status).sort()).toEqual([
      'cancelled',
      'cancelled',
      'failed',
      'sent',
    ]);
    const before = await get(w, campaignId);
    expect(before).toMatchObject({ status: 'stopped', sentCount: 1, failedCount: 1 });

    await expect(
      w.as.mutation(api.features.campaigns.mutations.resumeCampaignSending, {
        campaignId: await create(w),
      }),
    ).rejects.toMatchObject({ data: { code: 'campaign_not_stopped' } });
    await w.as.mutation(api.features.campaigns.mutations.resumeCampaignSending, { campaignId });
    expect((await get(w, campaignId)).status).toBe('preparing');
    expect(await jobs(w, 'resendCampaignBatch')).toEqual([
      { state: 'pending', args: { campaignId, only: 'cancelled' } },
    ]);
    // Two pages of one: the chain carries the word.
    expect(
      await w.t.mutation(fn.resendCampaignBatch, { campaignId, only: 'cancelled', batchSize: 1 }),
    ).toMatchObject({ isDone: false });
    const pending = (await jobs(w, 'resendCampaignBatch')).filter((j) => j.state === 'pending');
    expect(pending.at(-1)?.args).toMatchObject({ campaignId, only: 'cancelled', resent: 1 });
    expect(
      await w.t.mutation(fn.resendCampaignBatch, {
        campaignId,
        only: 'cancelled',
        batchSize: 1,
        cursor: pending.at(-1)?.args.cursor as string,
        resent: 1,
      }),
    ).toMatchObject({ isDone: true });

    const after = await get(w, campaignId);
    expect(after).toMatchObject({ status: 'sending', sentCount: 1, failedCount: 1 });
    expect(await jobState(w, after.drainFnId)).toBe('pending');
    const sends = await sendsOf(w, campaignId);
    expect(sends.find((s) => s._id === first._id)).toMatchObject({
      status: 'sent',
      brevoMessageId: 'm-1',
    });
    expect(sends.find((s) => s._id === second._id)).toMatchObject({
      status: 'failed',
      error: 'boom',
    });
    expect(sends.filter((s) => s.status === 'pending').map((s) => s.sendAt)).toEqual([NOW, NOW]);
    const events = await w.t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect())
        .map((a) => a.metadata as { event?: string; count?: number } | undefined)
        .filter((m): m is { event: string; count?: number } => m?.event !== undefined),
    );
    expect(events.at(-1)).toEqual({ event: 'resumed', count: 2 });
  });

  test('an optimised campaign resumed keeps each recipient’s hour; an A/B one resumed before its decision has its holdout due at once', async () => {
    const w = await setup(12);
    const leadIds = await w.t.run(async (ctx) =>
      (await ctx.db.query('leads').collect()).map((l) => l._id),
    );
    // Everyone opened at 23:00 UTC in an earlier campaign.
    const oldCampaign = await w.t.run((ctx) =>
      ctx.db.insert('campaigns', {
        name: 'Ancienne',
        channel: 'email',
        status: 'sent',
        totalCount: 1,
        sentCount: 1,
        failedCount: 0,
        updatedAt: NOW,
      }),
    );
    for (const leadId of leadIds) {
      const sendId = await w.t.run((ctx) =>
        ctx.db.insert('campaignSends', {
          campaignId: oldCampaign,
          leadId,
          params: {},
          status: 'sent',
        }),
      );
      await w.t.run((ctx) =>
        ctx.db.insert('campaignEvents', {
          campaignId: oldCampaign,
          sendId,
          leadId,
          type: 'opened',
          eventAt: Date.UTC(2026, 9, 1, 23, 0, 0),
        }),
      );
    }
    const campaignId = await w.as.mutation(api.features.campaigns.mutations.createCampaign, {
      name: 'Test',
      channel: 'email',
      filter: {},
      subject: 'Objet A',
      htmlBody: '<p>Corps</p>',
      messageType: 'transactional',
      sendTimeOptimized: true,
      abTest: {
        kind: 'subject',
        subjectB: 'Objet B',
        splitPercent: 50,
        windowHours: 2,
        metric: 'opens',
      },
    });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    await w.as.mutation(api.features.campaigns.mutations.stopCampaignSending, { campaignId });
    await w.t.mutation(fn.cancelPendingSends, { campaignId });
    // Resumed the next morning.
    const morning = Date.UTC(2026, 9, 14, 8, 0, 0);
    pinClock(morning);
    await w.as.mutation(api.features.campaigns.mutations.resumeCampaignSending, { campaignId });
    await w.t.mutation(fn.resendCampaignBatch, { campaignId, only: 'cancelled' });
    const sends = await sendsOf(w, campaignId);
    expect(sends.every((s) => s.status === 'pending')).toBe(true);
    // Each at their hour, the holdout included: tonight at eleven, no window to wait for.
    expect(new Set(sends.map((s) => s.sendAt))).toEqual(new Set([Date.UTC(2026, 9, 14, 23, 0, 0)]));
    pinClock(Date.UTC(2026, 9, 14, 23, 0, 0));
    const batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch?.sends).toHaveLength(sends.length);
    // The decision is asked at once, on no result: said so.
    expect(batch?.winnerPending).toBe(true);
    await w.t.mutation(fn.decideAbWinner, { campaignId });
    expect((await get(w, campaignId)).abTest).toMatchObject({ winner: 'A', decidedBy: 'fallback' });
  });

  test('while it prepares: the preparation chain ends with nothing more written; a settled campaign cannot be stopped', async () => {
    const w = await setup(2);
    const campaignId = await create(w);
    expect((await get(w, campaignId)).status).toBe('preparing');
    await w.as.mutation(api.features.campaigns.mutations.stopCampaignSending, { campaignId });
    expect((await get(w, campaignId)).status).toBe('stopped');
    expect(await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} })).toEqual({
      isDone: true,
      continueCursor: null,
    });
    expect(await sendsOf(w, campaignId)).toHaveLength(0);
    await expect(
      w.as.mutation(api.features.campaigns.mutations.stopCampaignSending, { campaignId }),
    ).rejects.toMatchObject({ data: { code: 'campaign_not_sending' } });
  });
});

describe('the hourly restart of the drains', () => {
  test('a campaign being sent whose call is gone while a send is due is drained again; one whose call waits, or with nothing due, is left alone', async () => {
    const w = await setup(1);
    const insert = (overrides: Partial<Doc<'campaigns'>>) =>
      w.t.run((ctx) =>
        ctx.db.insert('campaigns', {
          name: 'Relance',
          channel: 'email',
          status: 'sending',
          totalCount: 1,
          sentCount: 0,
          failedCount: 0,
          updatedAt: NOW,
          ...overrides,
        }),
      );
    const leadId = (await w.t.run((ctx) => ctx.db.query('leads').first()))!._id;
    const pendingSend = (campaignId: Id<'campaigns'>, sendAt: number) =>
      w.t.run((ctx) =>
        ctx.db.insert('campaignSends', {
          campaignId,
          leadId,
          params: {},
          status: 'pending',
          sendAt,
        }),
      );
    // Its call threw: the job is gone from the pending ones.
    const broken = await insert({});
    const brokenJob = await w.t.run(async (ctx) => {
      const id = await ctx.scheduler.runAfter(0, fn.markCampaignComplete, { campaignId: broken });
      await ctx.scheduler.cancel(id);
      return id;
    });
    await w.t.run((ctx) => ctx.db.patch(broken, { drainFnId: brokenJob }));
    await pendingSend(broken, NOW - HOUR);
    // Never had a call: a chain that broke before its first record.
    const orphan = await insert({});
    await pendingSend(orphan, NOW);
    // Sleeping until its next send, its call on record.
    const sleeping = await insert({});
    await w.t.mutation(fn.scheduleCampaignDrain, { campaignId: sleeping, at: NOW + 2 * HOUR });
    await pendingSend(sleeping, NOW - HOUR);
    // Nothing due before tonight.
    const later = await insert({});
    await pendingSend(later, NOW + 8 * HOUR);

    expect((await w.t.mutation(fn.restartStuckDrains, {})).sort()).toEqual([broken, orphan].sort());
    for (const id of [broken, orphan]) {
      expect(await jobState(w, (await get(w, id)).drainFnId)).toBe('pending');
    }
    expect((await get(w, later)).drainFnId).toBeUndefined();
    const sleepingJobs = (await jobs(w, 'sendCampaignBatch')).filter(
      (job) => job.args.campaignId === sleeping,
    );
    expect(sleepingJobs).toEqual([{ state: 'pending', args: { campaignId: sleeping } }]);
  });
});
