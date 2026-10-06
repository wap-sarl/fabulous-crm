import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { DAY_MS } from '../../convex/_lib/time';
import { countDb } from '../support/dbCounter';
import type { CampaignStats } from '../../convex/_lib/validators/crm';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 30, 0);
const HOUR = 3_600_000;
const hourOf = (at: number) => String(Math.floor(at / HOUR) * HOUR);
const fn = internal.features.campaigns.internal;

type World = { t: T; as: ReturnType<typeof asIdentity>; userId: Id<'users'> };

let savedKey: string | undefined;
beforeEach(() => {
  pinClock(NOW);
  // A Brevo key makes the e-mail provider configured, which a retry checks.
  savedKey = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = 'test-brevo-key';
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = savedKey;
});

async function setup(): Promise<World> {
  const t = createTestConvex();
  // The clock moves by hours: the session must outlive it.
  const emp = await seedEmployee(t, {
    email: 'agent@example.com',
    role: 'admin',
    sessionTtlMs: DAY_MS,
  });
  await seedConfig(t);
  return { t, as: asIdentity(t, emp.identity), userId: emp.userId };
}

const insertCampaign = (w: World, overrides: Partial<Doc<'campaigns'>> = {}) =>
  w.t.run((ctx) =>
    ctx.db.insert('campaigns', {
      name: 'Relance',
      channel: 'email',
      subject: 'Bonjour',
      htmlBody: '<p>Bonjour</p>',
      status: 'preparing',
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      statsCountedThrough: 'all',
      updatedAt: NOW,
      createdBy: w.userId,
      ...overrides,
    }),
  );

/** A send written without the trigger, as the sends older than the counters were. */
const insertSend = (
  w: World,
  campaignId: Id<'campaigns'>,
  leadId: Id<'leads'>,
  fields: Partial<Doc<'campaignSends'>> = {},
) =>
  w.t.run((ctx) =>
    ctx.db.insert('campaignSends', { campaignId, leadId, params: {}, status: 'sent', ...fields }),
  );

const shardsOf = (w: World, campaignId: Id<'campaigns'>) =>
  w.t.run((ctx) =>
    ctx.db
      .query('campaignStatShards')
      .withIndex('by_campaign_shard', (q) => q.eq('campaignId', campaignId))
      .collect(),
  );

const markOf = (w: World, campaignId: Id<'campaigns'>) =>
  w.t.run(async (ctx) => (await ctx.db.get(campaignId))?.statsCountedThrough);

/** The counts scheduled and not run, by their arguments. */
const countsScheduled = (w: World) =>
  w.t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.state.kind === 'pending' && job.name.includes('countCampaignStatsPage'))
      .map((job) => job.args[0] as Record<string, unknown>),
  );

/** The pages of a count run by hand until the last, two sends at a time; the number of pages it took. */
async function countToTheEnd(w: World, campaignId: Id<'campaigns'>): Promise<number> {
  for (let pages = 1; ; pages++) {
    const page = await w.t.mutation(fn.countCampaignStatsPage, { campaignId, pageSize: 2 });
    if (page.isDone) return pages;
  }
}

const sendsOf = (w: World, campaignId: Id<'campaigns'>) =>
  w.t.run((ctx) =>
    ctx.db
      .query('campaignSends')
      .withIndex('by_campaign', (q) => q.eq('campaignId', campaignId))
      .collect(),
  );

/** What the sends say, counted by hand: the counters must always equal this. */
function countedByHand(sends: Doc<'campaignSends'>[]): CampaignStats {
  const sentByHour: Record<string, number> = {};
  for (const send of sends) {
    if (send.sentAt === undefined) continue;
    sentByHour[hourOf(send.sentAt)] = (sentByHour[hourOf(send.sentAt)] ?? 0) + 1;
  }
  const having = (pick: (send: Doc<'campaignSends'>) => boolean) => sends.filter(pick).length;
  return {
    pending: having((s) => s.status === 'pending'),
    skipped: having((s) => s.status === 'skipped_no_email' || s.status === 'skipped_no_phone'),
    delivered: having((s) => s.deliveredAt !== undefined),
    opened: having((s) => s.openedAt !== undefined),
    clicked: having((s) => s.clickedAt !== undefined),
    replied: having((s) => s.repliedAt !== undefined),
    unsubscribed: having((s) => s.unsubscribedAt !== undefined),
    bounced: having((s) => s.bouncedAt !== undefined),
    sentByHour,
  };
}

const statsOf = (w: World, campaignId: Id<'campaigns'>) =>
  w.as.query(api.features.campaigns.queries.getCampaignStats, { campaignId });

/** The counters as the page reads them, checked against the sends. */
async function expectCounted(w: World, campaignId: Id<'campaigns'>): Promise<CampaignStats> {
  const stats = await statsOf(w, campaignId);
  expect(stats).toEqual(countedByHand(await sendsOf(w, campaignId)));
  return stats!;
}

describe('the counters of a campaign', () => {
  test('they follow the sends of an e-mail campaign: prepared, sent or failed, opened, clicked, sent again, erased', async () => {
    const w = await setup();
    const reached = await seedLead(w.t, { firstName: 'Ada', email: 'ada@example.com' });
    const missed = await seedLead(w.t, { firstName: 'Bob', email: 'bob@example.com' });
    await seedLead(w.t, { firstName: 'Nul', email: undefined });
    const campaignId = await insertCampaign(w);

    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    expect(await expectCounted(w, campaignId)).toMatchObject({
      pending: 2,
      skipped: 1,
      sentByHour: {},
    });

    const sends = await sendsOf(w, campaignId);
    const sent = sends.find((s) => s.leadId === reached)!._id;
    const failed = sends.find((s) => s.leadId === missed)!._id;
    pinClock(NOW + 2 * HOUR);
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: [
        { sendId: sent, status: 'sent', brevoMessageId: 'm-1' },
        { sendId: failed, status: 'failed', error: 'refused' },
      ],
    });
    // A failed send left too: it counts in the hour it was tried.
    expect(await expectCounted(w, campaignId)).toMatchObject({
      pending: 0,
      sentByHour: { [hourOf(NOW + 2 * HOUR)]: 2 },
    });

    for (const type of ['opened', 'opened', 'clicked'] as const) {
      await w.t.mutation(fn.recordBrevoEmailEvent, {
        brevoMessageId: 'm-1',
        type,
        eventAt: NOW + 3 * HOUR,
      });
    }
    expect(await expectCounted(w, campaignId)).toMatchObject({ opened: 1, clicked: 1 });

    // Sent again: the send is pending once more, and what it had earned is forgotten.
    await w.t.run((ctx) => ctx.db.patch(campaignId, { status: 'sent' }));
    await w.as.mutation(api.features.campaigns.mutations.retryCampaignSend, {
      campaignId,
      sendId: sent,
    });
    expect(await expectCounted(w, campaignId)).toMatchObject({
      pending: 1,
      opened: 0,
      clicked: 0,
      sentByHour: { [hourOf(NOW + 2 * HOUR)]: 1 },
    });

    // A contact erased by the purge takes its send away; one page is enough, nothing else is scheduled to run.
    await w.t.run((ctx) => ctx.db.patch(missed, { deletedAt: NOW - 40 * DAY_MS }));
    await w.t.mutation(internal.features.retention.internal.runPurge, {});
    expect(await sendsOf(w, campaignId)).toHaveLength(2);
    expect(await expectCounted(w, campaignId)).toMatchObject({ sentByHour: {} });
  });

  test('a campaign created in the product has its counters from its first send, without any count', async () => {
    const w = await setup();
    await seedLead(w.t, { firstName: 'Ada', email: 'ada@example.com' });
    await seedLead(w.t, { firstName: 'Nul', email: undefined });
    const campaignId = await w.as.mutation(api.features.campaigns.mutations.createCampaign, {
      name: 'Relance',
      channel: 'email',
      filter: {},
      subject: 'Bonjour',
      htmlBody: '<p>Bonjour</p>',
    });
    expect(await markOf(w, campaignId)).toBe('all');
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    expect(await expectCounted(w, campaignId)).toMatchObject({ pending: 1, skipped: 1 });
  });

  test('they follow what the operator reports of a text message: delivered, replied, bounced, stopped', async () => {
    const w = await setup();
    await seedLead(w.t, { phone: '+33612345678', marketingConsent: ['sms'] });
    await seedLead(w.t, { phone: '+33612345679', marketingConsent: ['sms'] });
    const campaignId = await insertCampaign(w, { channel: 'sms', smsBody: 'Bonjour' });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const [first, second] = await sendsOf(w, campaignId);
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: [
        { sendId: first._id, status: 'sent', brevoMessageId: 'sms-1' },
        { sendId: second._id, status: 'sent', brevoMessageId: 'sms-2' },
      ],
    });
    const report = (brevoMessageId: string, msgStatus: string, eventAt: number) =>
      w.t.mutation(fn.handleSmsEvent, { brevoMessageId, msgStatus, eventAt });

    await report('sms-1', 'delivered', NOW + 1);
    await report('sms-1', 'delivered', NOW + 2);
    await report('sms-1', 'replied', NOW + 3);
    await report('sms-2', 'hard_bounce', NOW + 4);
    await report('sms-1', 'unsubscribed', NOW + 5);
    expect(await expectCounted(w, campaignId)).toMatchObject({
      delivered: 1,
      replied: 1,
      bounced: 1,
      unsubscribed: 1,
      sentByHour: { [hourOf(NOW)]: 2 },
    });
  });

  test('a provider event writes one row of the counters and never the campaign; the rows are sixteen at most, and only their sum is read', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const campaignId = await insertCampaign(w, { status: 'sent' });
    const sendId = await insertSend(w, campaignId, leadId, { brevoMessageId: 'm-1' });

    const event = await countDb(() =>
      w.t.mutation(fn.recordBrevoEmailEvent, {
        brevoMessageId: 'm-1',
        type: 'opened',
        eventAt: NOW + 1,
      }),
    );
    expect(event.writes.campaigns).toBeUndefined();
    expect(event.writes.campaignStatShards).toBe(1);
    expect(await statsOf(w, campaignId)).toMatchObject({ opened: 1 });

    // Two hundred changes of the same send, sent then queued again, each on a row picked at random: the rows fill up, one per number.
    for (let i = 0; i < 100; i++) {
      await w.t.mutation(fn.recordSendResults, {
        campaignId,
        results: [{ sendId, status: 'sent' }],
      });
      await w.t.run((ctx) => ctx.db.patch(campaignId, { status: 'preparing' }));
      await w.t.mutation(fn.resendCampaignBatch, { campaignId });
    }
    const shards = await shardsOf(w, campaignId);
    expect(shards.length).toBeGreaterThan(1);
    expect(shards.length).toBeLessThanOrEqual(16);
    expect(new Set(shards.map((shard) => shard.shard)).size).toBe(shards.length);
    expect(await statsOf(w, campaignId)).toEqual({ ...countedByHand([]), pending: 1 });
    const read = await countDb(() => statsOf(w, campaignId));
    expect(read.reads.campaignStatShards).toBe(shards.length);
    expect(read.reads.campaignSends).toBeUndefined();
  });

  test('a campaign older than the counters is left alone and reads zeros, until the backfill counts its sends in pages', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const older = await insertCampaign(w, { status: 'sent', statsCountedThrough: undefined });
    const newer = await insertCampaign(w, { status: 'sent' });
    await insertSend(w, older, leadId, { sentAt: NOW, openedAt: NOW + 1, clickedAt: NOW + 2 });
    await insertSend(w, older, leadId, { sentAt: NOW + HOUR, deliveredAt: NOW + HOUR + 1 });
    const pending = await insertSend(w, older, leadId, { status: 'pending' });
    await insertSend(w, older, leadId, { status: 'skipped_no_email' });
    await insertSend(w, newer, leadId, { sentAt: NOW, brevoMessageId: 'm-new' });

    // Not counted yet: a send that changes writes nothing, the count will read it as it is then.
    await w.t.mutation(fn.recordSendResults, {
      campaignId: older,
      results: [{ sendId: pending, status: 'sent' }],
    });
    expect(await shardsOf(w, older)).toEqual([]);
    expect(await statsOf(w, older)).toEqual(countedByHand([]));

    await w.t.mutation(internal.migrations.countCampaignStats, {});
    // Only the one that was never counted starts a count.
    expect(await countsScheduled(w)).toEqual([{ campaignId: older }]);
    expect(await markOf(w, older)).toBe(0);
    expect(await markOf(w, newer)).toBe('all');

    expect(await countToTheEnd(w, older)).toBe(2);
    expect(await markOf(w, older)).toBe('all');
    expect(await expectCounted(w, older)).toMatchObject({
      pending: 0,
      skipped: 1,
      delivered: 1,
      opened: 1,
      clicked: 1,
      sentByHour: { [hourOf(NOW)]: 2, [hourOf(NOW + HOUR)]: 1 },
    });
    // Counted, it follows its sends like any other.
    await w.t.mutation(fn.recordSendResults, {
      campaignId: older,
      results: [{ sendId: pending, status: 'pending' }],
    });
    expect(await expectCounted(w, older)).toMatchObject({ pending: 1 });
    // A page that comes after the end changes nothing.
    expect(await w.t.mutation(fn.countCampaignStatsPage, { campaignId: older })).toEqual({
      isDone: true,
    });
    await expectCounted(w, older);
  });

  test('a count is exact whatever is written while it runs, and puts right counters that were wrong, as often as it is run', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const campaignId = await insertCampaign(w, { status: 'sent' });
    const sends: Id<'campaignSends'>[] = [];
    for (let i = 1; i <= 5; i++) {
      sends.push(
        await insertSend(w, campaignId, leadId, { sentAt: NOW, brevoMessageId: `m-${i}` }),
      );
    }
    // Counters that drifted: none of these sends was ever counted, and one row says seven opened.
    await w.t.run((ctx) =>
      ctx.db.insert('campaignStatShards', {
        campaignId,
        shard: 3,
        stats: { ...countedByHand([]), opened: 7 },
      }),
    );
    expect(await statsOf(w, campaignId)).toMatchObject({ opened: 7, sentByHour: {} });
    const open = (number: number) =>
      w.t.mutation(fn.recordBrevoEmailEvent, {
        brevoMessageId: `m-${number}`,
        type: 'opened',
        eventAt: NOW + number,
      });

    await w.t.mutation(fn.recountCampaignStats, { campaignId });
    expect(await shardsOf(w, campaignId)).toEqual([]);
    expect(await countsScheduled(w)).toEqual([{ campaignId }]);

    // The first page has read the first two sends: from here the trigger follows these two, and only them.
    expect(await w.t.mutation(fn.countCampaignStatsPage, { campaignId, pageSize: 2 })).toEqual({
      isDone: false,
    });
    expect(await markOf(w, campaignId)).toBe((await sendsOf(w, campaignId))[1]._creationTime);
    expect(await countsScheduled(w)).toContainEqual({ campaignId, pageSize: 2 });
    expect(await statsOf(w, campaignId)).toMatchObject({ sentByHour: { [hourOf(NOW)]: 2 } });
    // The second send is the one the mark stands on: read, so followed.
    await open(2);
    expect(await statsOf(w, campaignId)).toMatchObject({ opened: 1 });
    // Not read yet: the event writes no row, the page that reads the send counts it opened.
    const early = await countDb(() => open(4));
    expect(early.writes.campaignStatShards).toBeUndefined();
    expect(await statsOf(w, campaignId)).toMatchObject({ opened: 1 });
    // Written while the count runs, after its mark: left to the count as well.
    sends.push(await insertSend(w, campaignId, leadId, { status: 'pending' }));
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: [{ sendId: sends[5], status: 'sent', brevoMessageId: 'm-6' }],
    });

    expect(await countToTheEnd(w, campaignId)).toBe(2);
    expect(await expectCounted(w, campaignId)).toMatchObject({
      pending: 0,
      opened: 2,
      sentByHour: { [hourOf(NOW)]: 6 },
    });

    // Started again halfway through, with the chain of the first start still going: the pages are shared, nothing counts twice.
    await w.t.mutation(fn.recountCampaignStats, { campaignId });
    await w.t.mutation(fn.countCampaignStatsPage, { campaignId, pageSize: 2 });
    await w.t.mutation(fn.recountCampaignStats, { campaignId });
    expect(await statsOf(w, campaignId)).toEqual(countedByHand([]));
    await open(5);
    expect(await countToTheEnd(w, campaignId)).toBe(3);
    expect(await expectCounted(w, campaignId)).toMatchObject({ opened: 3 });
  });

  test('a count that is asked for a campaign that does not exist is refused', async () => {
    const w = await setup();
    const campaignId = await insertCampaign(w);
    await w.t.run((ctx) => ctx.db.delete(campaignId));
    await expect(w.t.mutation(fn.recountCampaignStats, { campaignId })).rejects.toMatchObject({
      data: { code: 'campaign_not_found' },
    });
    expect(await w.t.mutation(fn.countCampaignStatsPage, { campaignId })).toEqual({
      isDone: true,
    });
  });
});
