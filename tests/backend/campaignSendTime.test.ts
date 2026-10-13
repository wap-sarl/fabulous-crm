import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { bestOpenHour, nextSlot } from '../../convex/lib/campaigns/sendTime';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 13, 10, 30, 0);
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
    sessionTtlMs: 3 * 24 * HOUR,
  });
  await seedConfig(t);
  return { t, as: asIdentity(t, emp.identity), userId: emp.userId };
}

const opened = (at: number) => ({ type: 'opened' as const, eventAt: at });
const clicked = (at: number) => ({ type: 'clicked' as const, eventAt: at });
const utc = (day: number, hour: number, minute = 0) => Date.UTC(2026, 8, day, hour, minute);

describe('the hour a recipient opens most', () => {
  test('is the hour of the day with the most opens, the most recently opened on a tie; clicks and silence count for nothing', () => {
    expect(bestOpenHour([])).toBeNull();
    expect(bestOpenHour([clicked(utc(1, 9))])).toBeNull();
    expect(bestOpenHour([opened(utc(1, 9)), opened(utc(2, 9, 45)), opened(utc(3, 14))])).toBe(9);
    expect(bestOpenHour([opened(utc(1, 9)), opened(utc(2, 14))])).toBe(14);
    expect(bestOpenHour([opened(utc(5, 9)), opened(utc(2, 14))])).toBe(9);
  });

  test('the next slot is now within that hour, else the start of that hour within the day that follows', () => {
    const base = utc(10, 10, 30);
    expect(nextSlot(base, 10)).toBe(base);
    expect(nextSlot(base, 14)).toBe(utc(10, 14));
    expect(nextSlot(base, 9)).toBe(utc(11, 9));
    expect(nextSlot(base, 0)).toBe(utc(11, 0));
  });
});

describe('an optimised campaign', () => {
  test('sends each recipient at their hour, at once without an open on record, and the drain sleeps until the next one', async () => {
    const w = await setup();
    const lead = async (email: string) =>
      w.as.mutation(api.features.leads.mutations.createLead, {
        firstName: 'Jean',
        lastName: email,
        email,
      });
    const morning = await lead('matin@example.com');
    const quiet = await lead('calme@example.com');
    // Opens from an earlier campaign: twice at 9, once at 14 (UTC).
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
    const oldSend = await w.t.run((ctx) =>
      ctx.db.insert('campaignSends', {
        campaignId: oldCampaign,
        leadId: morning,
        params: {},
        status: 'sent',
      }),
    );
    for (const at of [utc(1, 9, 10), utc(2, 9, 50), utc(3, 14)]) {
      await w.t.run((ctx) =>
        ctx.db.insert('campaignEvents', {
          campaignId: oldCampaign,
          sendId: oldSend,
          leadId: morning,
          type: 'opened',
          eventAt: at,
        }),
      );
    }

    const campaignId = await w.as.mutation(api.features.campaigns.mutations.createCampaign, {
      name: 'Relance',
      channel: 'email',
      filter: {},
      subject: 'Bonjour',
      htmlBody: '<p>Bonjour</p>',
      messageType: 'transactional',
      sendTimeOptimized: true,
    });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const sends = await w.t.run((ctx) => ctx.db.query('campaignSends').collect());
    const at = new Map(
      sends.filter((s) => s.campaignId === campaignId).map((s) => [s.leadId, s.sendAt]),
    );
    // Now is 10:30: the next 9 o'clock is tomorrow's.
    expect(at.get(morning)).toBe(Date.UTC(2026, 9, 14, 9, 0, 0));
    expect(at.get(quiet)).toBe(NOW);

    // Due now: the quiet one; the drain is told when the other is.
    let batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch?.sends.map((s) => s.email)).toEqual(['calme@example.com']);
    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: [{ sendId: batch!.sends[0].sendId, status: 'sent', brevoMessageId: 'm-1' }],
    });
    batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch).toMatchObject({ sends: [], nextAt: Date.UTC(2026, 9, 14, 9, 0, 0) });
    pinClock(Date.UTC(2026, 9, 14, 9, 0, 0));
    batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch?.sends.map((s) => s.email)).toEqual(['matin@example.com']);
    expect(batch?.nextAt).toBeUndefined();
  });

  test('an SMS campaign has no opens to read: the option is dropped', async () => {
    const w = await setup();
    const campaignId = await w.as.mutation(api.features.campaigns.mutations.createCampaign, {
      name: 'SMS',
      channel: 'sms',
      filter: {},
      smsBody: 'Bonjour',
      messageType: 'transactional',
      sendTimeOptimized: true,
    });
    expect((await w.t.run((ctx) => ctx.db.get(campaignId)))?.sendTimeOptimized).toBeUndefined();
  });
});
