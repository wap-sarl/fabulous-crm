import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { readCampaignStats } from '../../convex/lib/campaigns/stats';
import { assignVariant, pickWinner, variantContent } from '../../convex/lib/campaigns/variants';
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

async function setup(): Promise<World> {
  const t = createTestConvex();
  const emp = await seedEmployee(t, {
    email: 'agent@example.com',
    role: 'admin',
    sessionTtlMs: 24 * HOUR,
  });
  await seedConfig(t);
  return { t, as: asIdentity(t, emp.identity), userId: emp.userId };
}

const stats = (variants: Record<string, { sent: number; opened: number; clicked: number }>) => ({
  pending: 0,
  skipped: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  replied: 0,
  unsubscribed: 0,
  bounced: 0,
  sentByHour: {},
  variants,
});

describe('the variants of a test', () => {
  test('a recipient lands in the same group every time, the share is respected and split in two', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `lead-${i}`);
    const once = ids.map((id) => assignVariant('campaign-1', id, 20));
    expect(ids.map((id) => assignVariant('campaign-1', id, 20))).toEqual(once);
    const count = (variant: 'A' | 'B' | undefined) => once.filter((v) => v === variant).length;
    expect(count('A') + count('B')).toBeGreaterThan(320);
    expect(count('A') + count('B')).toBeLessThan(480);
    expect(Math.abs(count('A') - count('B'))).toBeLessThan(80);
    // Another campaign shuffles the groups.
    expect(ids.map((id) => assignVariant('campaign-2', id, 20))).not.toEqual(once);
    expect(
      ids.map((id) => assignVariant('campaign-1', id, 100)).every((v) => v !== undefined),
    ).toBe(true);
  });

  test('B carries the subject or the body it tests, A and the holdout the campaign’s own', () => {
    const subjectTest = {
      subject: 'Objet A',
      htmlBody: '<p>A</p>',
      abTest: {
        kind: 'subject' as const,
        subjectB: 'Objet B',
        splitPercent: 20,
        windowHours: 4,
        metric: 'opens' as const,
      },
    };
    expect(variantContent(subjectTest, 'A')).toEqual({ subject: 'Objet A', htmlBody: '<p>A</p>' });
    expect(variantContent(subjectTest, 'B')).toEqual({ subject: 'Objet B', htmlBody: '<p>A</p>' });
    expect(variantContent(subjectTest, undefined)).toEqual({
      subject: 'Objet A',
      htmlBody: '<p>A</p>',
    });
    const contentTest = {
      ...subjectTest,
      abTest: {
        ...subjectTest.abTest,
        kind: 'content' as const,
        subjectB: undefined,
        htmlBodyB: '<p>B</p>',
      },
    };
    expect(variantContent(contentTest, 'B')).toEqual({ subject: 'Objet A', htmlBody: '<p>B</p>' });
    expect(variantContent({ subject: 'Objet A', htmlBody: '<p>A</p>' }, 'B')).toEqual({
      subject: 'Objet A',
      htmlBody: '<p>A</p>',
    });
  });

  test('the winner is the better rate on the metric; A on a tie; without a send or a result on either side, A by default and said so', () => {
    const result = (winner: 'A' | 'B') => ({ winner, decidedBy: 'result' as const });
    expect(
      pickWinner(
        stats({ A: { sent: 10, opened: 3, clicked: 0 }, B: { sent: 10, opened: 5, clicked: 0 } }),
        'opens',
      ),
    ).toEqual(result('B'));
    expect(
      pickWinner(
        stats({ A: { sent: 10, opened: 3, clicked: 2 }, B: { sent: 20, opened: 8, clicked: 1 } }),
        'clicks',
      ),
    ).toEqual(result('A'));
    expect(
      pickWinner(
        stats({ A: { sent: 5, opened: 2, clicked: 0 }, B: { sent: 10, opened: 4, clicked: 0 } }),
        'opens',
      ),
    ).toEqual(result('A'));
    expect(
      pickWinner(
        stats({ A: { sent: 0, opened: 0, clicked: 0 }, B: { sent: 1, opened: 1, clicked: 1 } }),
        'opens',
      ),
    ).toEqual(result('B'));
    expect(pickWinner(stats({}), 'opens')).toEqual({ winner: 'A', decidedBy: 'fallback' });
    expect(
      pickWinner(
        stats({ A: { sent: 10, opened: 3, clicked: 0 }, B: { sent: 10, opened: 5, clicked: 0 } }),
        'clicks',
      ),
    ).toEqual({ winner: 'A', decidedBy: 'fallback' });
  });
});

describe('an A/B campaign', () => {
  test('sends its test group at once with A or B, holds the rest until the window closes, counts each variant, decides the winner from its counters and sends it to the rest', async () => {
    const w = await setup();
    for (let i = 0; i < 40; i++) {
      await w.as.mutation(api.features.leads.mutations.createLead, {
        firstName: 'Jean',
        lastName: `N${i}`,
        email: `lead${i}@example.com`,
      });
    }
    const campaignId = await w.as.mutation(api.features.campaigns.mutations.createCampaign, {
      name: 'Test',
      channel: 'email',
      filter: {},
      subject: 'Objet A',
      htmlBody: '<p>Corps</p>',
      messageType: 'transactional',
      abTest: {
        kind: 'subject',
        subjectB: ' Objet B ',
        splitPercent: 50,
        windowHours: 4,
        metric: 'opens',
      },
    });
    expect((await w.t.run((ctx) => ctx.db.get(campaignId)))?.abTest).toEqual({
      kind: 'subject',
      subjectB: 'Objet B',
      htmlBodyB: undefined,
      splitPercent: 50,
      windowHours: 4,
      metric: 'opens',
    });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const sends = await w.t.run((ctx) => ctx.db.query('campaignSends').collect());
    const of = (variant: 'A' | 'B' | undefined) => sends.filter((s) => s.variant === variant);
    expect(of('A').length).toBeGreaterThan(0);
    expect(of('B').length).toBeGreaterThan(0);
    expect(of(undefined).length).toBeGreaterThan(0);
    expect([...of('A'), ...of('B')].every((s) => s.sendAt === NOW)).toBe(true);
    expect(of(undefined).every((s) => s.sendAt === NOW + 4 * HOUR)).toBe(true);

    // Due now: the test group only, and no decision asked.
    let batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch?.sends).toHaveLength(of('A').length + of('B').length);
    expect(batch?.winnerPending).toBe(false);
    expect(batch?.sends.every((s) => s.variant !== undefined)).toBe(true);
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: batch!.sends.map((s) => ({
        sendId: s.sendId,
        status: 'sent' as const,
        brevoMessageId: `m-${s.sendId}`,
      })),
    });
    // Every B opened, one A.
    for (const s of [...of('B'), of('A')[0]]) {
      await w.t.mutation(fn.recordBrevoEmailEvent, {
        brevoMessageId: `m-${s._id}`,
        type: 'opened',
        eventAt: NOW + HOUR,
      });
    }
    const counted = await w.t.run((ctx) => readCampaignStats(ctx, campaignId));
    expect(counted.variants).toEqual({
      A: { sent: of('A').length, opened: 1, clicked: 0 },
      B: { sent: of('B').length, opened: of('B').length, clicked: 0 },
    });
    expect(counted.pending).toBe(of(undefined).length);

    // The window closes: the holdout is due, the decision first.
    batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch).toMatchObject({ sends: [], nextAt: NOW + 4 * HOUR });
    pinClock(NOW + 4 * HOUR);
    batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch?.winnerPending).toBe(true);
    expect(await w.t.mutation(fn.decideAbWinner, { campaignId })).toBe('B');
    const decided = (await w.t.run((ctx) => ctx.db.get(campaignId))) as Doc<'campaigns'>;
    expect(decided.abTest).toMatchObject({
      winner: 'B',
      decidedAt: NOW + 4 * HOUR,
      decidedBy: 'result',
    });
    // Decided once: a second call changes nothing.
    expect(await w.t.mutation(fn.decideAbWinner, { campaignId })).toBe('B');
    batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch).toMatchObject({ winnerPending: false, abTest: { winner: 'B' } });
    expect(batch?.sends).toHaveLength(of(undefined).length);
    expect(variantContent(batch!, batch!.sends[0].variant ?? batch!.abTest?.winner).subject).toBe(
      'Objet B',
    );
    const events = await w.t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect())
        .map((a) => (a.metadata as { event?: string } | undefined)?.event)
        .filter((event): event is string => event !== undefined),
    );
    expect(events).toEqual(['ab_winner']);
  });

  test('with the send time optimised, the window opens once the day of test sends is over, so the decision waits for every test send', async () => {
    const w = await setup();
    const leads: Id<'leads'>[] = [];
    for (let i = 0; i < 30; i++) {
      leads.push(
        await w.as.mutation(api.features.leads.mutations.createLead, {
          firstName: 'Jean',
          lastName: `N${i}`,
          email: `lead${i}@example.com`,
        }),
      );
    }
    // Everyone opened at 23:00 UTC: the latest hour of the day, thirteen hours from now.
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
    for (const leadId of leads) {
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
        windowHours: 1,
        metric: 'opens',
      },
    });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const sends = (await w.t.run((ctx) => ctx.db.query('campaignSends').collect())).filter(
      (s) => s.campaignId === campaignId,
    );
    const tested = sends.filter((s) => s.variant !== undefined);
    const holdout = sends.filter((s) => s.variant === undefined);
    expect(tested.length).toBeGreaterThan(0);
    expect(holdout.length).toBeGreaterThan(0);
    const tonight = Date.UTC(2026, 9, 13, 23, 0, 0);
    expect(tested.every((s) => s.sendAt === tonight)).toBe(true);
    // The window of one hour opens a day after the start; the holdout then waits for its hour, tomorrow night.
    expect(holdout.every((s) => s.sendAt === tonight + 24 * HOUR)).toBe(true);
    pinClock(tonight + HOUR);
    const batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch?.winnerPending).toBe(false);
    expect(batch?.sends).toHaveLength(tested.length);
  });

  test('without a send or a result on either side, A goes by default and the record says so', async () => {
    const w = await setup();
    for (let i = 0; i < 10; i++) {
      await w.as.mutation(api.features.leads.mutations.createLead, {
        firstName: 'Jean',
        lastName: `N${i}`,
        email: `lead${i}@example.com`,
      });
    }
    const campaignId = await w.as.mutation(api.features.campaigns.mutations.createCampaign, {
      name: 'Test',
      channel: 'email',
      filter: {},
      subject: 'Objet A',
      htmlBody: '<p>Corps</p>',
      messageType: 'transactional',
      abTest: {
        kind: 'subject',
        subjectB: 'Objet B',
        splitPercent: 50,
        windowHours: 4,
        metric: 'clicks',
      },
    });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const batch = await w.t.query(fn.getPendingSends, { campaignId });
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: batch!.sends.map((s) => ({
        sendId: s.sendId,
        status: 'sent' as const,
        brevoMessageId: `m-${s.sendId}`,
      })),
    });
    pinClock(NOW + 4 * HOUR);
    expect(await w.t.mutation(fn.decideAbWinner, { campaignId })).toBe('A');
    expect((await w.t.run((ctx) => ctx.db.get(campaignId)))?.abTest).toMatchObject({
      winner: 'A',
      decidedBy: 'fallback',
    });
    const entry = await w.t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect())
        .map((a) => a.metadata as Record<string, unknown> | undefined)
        .find((m) => m?.event === 'ab_winner'),
    );
    expect(entry).toMatchObject({ winner: 'A', decidedBy: 'fallback', metric: 'clicks' });
    expect(entry?.A ?? entry?.B).toBeDefined();
  });

  test('a test needs a custom e-mail, its variant B, and bounds', async () => {
    const w = await setup();
    const create = (extra: Record<string, unknown>) =>
      w.as.mutation(api.features.campaigns.mutations.createCampaign, {
        name: 'Test',
        channel: 'email',
        filter: {},
        subject: 'Objet A',
        htmlBody: '<p>Corps</p>',
        messageType: 'transactional',
        ...extra,
      });
    const test = {
      kind: 'subject',
      subjectB: 'Objet B',
      splitPercent: 20,
      windowHours: 4,
      metric: 'opens',
    };
    await expect(
      create({ htmlBody: undefined, subject: undefined, brevoTemplateId: 7, abTest: test }),
    ).rejects.toMatchObject({ data: { code: 'ab_test_unavailable' } });
    await expect(create({ abTest: { ...test, subjectB: ' ' } })).rejects.toMatchObject({
      data: { code: 'ab_variant_required' },
    });
    await expect(create({ abTest: { ...test, kind: 'content' } })).rejects.toMatchObject({
      data: { code: 'ab_variant_required' },
    });
    await expect(create({ abTest: { ...test, splitPercent: 5 } })).rejects.toMatchObject({
      data: { code: 'ab_test_invalid' },
    });
    await expect(create({ abTest: { ...test, windowHours: 100 } })).rejects.toMatchObject({
      data: { code: 'ab_test_invalid' },
    });
    const campaignId = await create({
      abTest: { ...test, kind: 'content', htmlBodyB: '<p>B</p>' },
    });
    const stored = (await w.t.run((ctx) => ctx.db.get(campaignId)))?.abTest;
    expect(stored).toMatchObject({ kind: 'content', htmlBodyB: '<p>B</p>' });
    expect(stored?.subjectB).toBeUndefined();
  });
});
