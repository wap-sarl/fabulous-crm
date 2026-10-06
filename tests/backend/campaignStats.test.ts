import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { DAY_MS } from '../../convex/_lib/time';
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
      updatedAt: NOW,
      createdBy: w.userId,
      ...overrides,
    }),
  );

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

const statsOf = async (w: World, campaignId: Id<'campaigns'>) =>
  (await w.as.query(api.features.campaigns.queries.getCampaign, { campaignId }))?.stats;

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

  test('a campaign older than the counters reads zeros until the backfill counts its sends, which it does once', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const older = await insertCampaign(w, { status: 'sent' });
    const newer = await insertCampaign(w, { status: 'sent' });
    const insertSend = (campaignId: Id<'campaigns'>, fields: Partial<Doc<'campaignSends'>>) =>
      w.t.run((ctx) =>
        ctx.db.insert('campaignSends', {
          campaignId,
          leadId,
          params: {},
          status: 'sent',
          ...fields,
        }),
      );
    await insertSend(older, { sentAt: NOW, openedAt: NOW + 1, clickedAt: NOW + 2 });
    await insertSend(older, { sentAt: NOW + HOUR, deliveredAt: NOW + HOUR + 1 });
    await insertSend(older, { status: 'pending' });
    await insertSend(older, { status: 'skipped_no_email' });
    await insertSend(newer, { sentAt: NOW, bouncedAt: NOW + 1 });
    // The newer campaign has counters already, wrong on purpose: the backfill recounts, it does not add.
    await w.t.run((ctx) =>
      ctx.db.patch(newer, { stats: { ...countedByHand([]), opened: 7, sentByHour: { x: 1 } } }),
    );
    expect(await statsOf(w, older)).toEqual(countedByHand([]));

    await w.t.mutation(internal.migrations.resetCampaignStats, {});
    await w.t.mutation(internal.migrations.countCampaignSends, {});
    expect(await expectCounted(w, older)).toMatchObject({
      pending: 1,
      skipped: 1,
      delivered: 1,
      opened: 1,
      clicked: 1,
      sentByHour: { [hourOf(NOW)]: 1, [hourOf(NOW + HOUR)]: 1 },
    });
    expect(await expectCounted(w, newer)).toMatchObject({ opened: 0, bounced: 1 });
  });

  test('a send the counters never saw cannot take a count below zero', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const campaignId = await insertCampaign(w, { status: 'sending' });
    const sendId = await w.t.run((ctx) =>
      ctx.db.insert('campaignSends', { campaignId, leadId, params: {}, status: 'pending' }),
    );
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: [{ sendId, status: 'sent', brevoMessageId: 'm-1' }],
    });
    expect(await statsOf(w, campaignId)).toEqual({
      ...countedByHand([]),
      sentByHour: { [hourOf(NOW)]: 1 },
    });
  });
});
