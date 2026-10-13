import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ConvexError } from 'convex/values';
import { api, internal } from '../../convex/_generated/api';
import { setExtensionsForTests } from '../../convex/extensions';
import { defaultExtensions } from '../../convex/lib/extensions/types';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { DAY_MS } from '../../convex/_lib/time';
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
  // The clock moves by days: the session must outlive it.
  const emp = await seedEmployee(t, {
    email: 'agent@example.com',
    role: 'admin',
    sessionTtlMs: 400 * DAY_MS,
  });
  await seedConfig(t);
  const as = asIdentity(t, emp.identity);
  for (const [email, flagged] of [
    ['a@example.com', true],
    ['b@example.com', false],
  ] as const) {
    await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Jean',
      lastName: email,
      email,
      isRedFlagged: flagged,
    });
  }
  return { t, as, userId: emp.userId };
}

const create = (w: World, extra: Record<string, unknown> = {}) =>
  w.as.mutation(api.features.campaigns.mutations.createCampaign, {
    name: 'Relance',
    channel: 'email',
    filter: {},
    subject: 'Bonjour',
    htmlBody: '<p>Bonjour</p>',
    messageType: 'transactional',
    ...extra,
  });

const get = (w: World, id: Id<'campaigns'>) =>
  w.t.run(async (ctx) => (await ctx.db.get(id)) as Doc<'campaigns'>);

/** The scheduled calls, by the name of their function, with their state and time. */
const jobs = (w: World, name: string) =>
  w.t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.name.includes(name))
      .map((job) => ({
        state: job.state.kind,
        at: job.scheduledTime,
        args: job.args[0] as Record<string, unknown>,
      })),
  );

const audits = (w: World, id: Id<'campaigns'>) =>
  w.t.run(async (ctx) =>
    (await ctx.db.query('auditLogs').collect())
      .filter((a) => a.entityId === id)
      .map((a) => (a.metadata as { event?: string }).event),
  );

describe('a scheduled campaign', () => {
  test('waits for its time with no recipient resolved, is cancelled into a draft, given a new time, and started by hand with the filter it kept', async () => {
    const w = await setup();
    const at = NOW + DAY_MS;
    const campaignId = await create(w, { scheduledAt: at, filter: { isRedFlagged: true } });
    let campaign = await get(w, campaignId);
    expect(campaign).toMatchObject({
      status: 'scheduled',
      scheduledAt: at,
      filter: { isRedFlagged: true },
    });
    expect(campaign.scheduledFnId).toBeDefined();
    expect(await jobs(w, 'startScheduledCampaign')).toEqual([
      { state: 'pending', at, args: { campaignId } },
    ]);
    expect(await jobs(w, 'prepareCampaignBatch')).toEqual([]);
    expect(await w.t.run((ctx) => ctx.db.query('campaignSends').collect())).toHaveLength(0);

    // Off the schedule: the call is cancelled, the campaign waits as a draft.
    await w.as.mutation(api.features.campaigns.mutations.cancelScheduledCampaign, { campaignId });
    campaign = await get(w, campaignId);
    expect(campaign.status).toBe('draft');
    expect(campaign.scheduledAt).toBeUndefined();
    expect(campaign.scheduledFnId).toBeUndefined();
    expect((await jobs(w, 'startScheduledCampaign')).map((job) => job.state)).toEqual(['canceled']);

    // A new time from the draft, then another: one call waits.
    await w.as.mutation(api.features.campaigns.mutations.scheduleCampaign, {
      campaignId,
      scheduledAt: at + HOUR,
    });
    await w.as.mutation(api.features.campaigns.mutations.scheduleCampaign, {
      campaignId,
      scheduledAt: at + 2 * HOUR,
    });
    campaign = await get(w, campaignId);
    expect(campaign).toMatchObject({ status: 'scheduled', scheduledAt: at + 2 * HOUR });
    expect(
      (await jobs(w, 'startScheduledCampaign')).filter((job) => job.state === 'pending'),
    ).toEqual([{ state: 'pending', at: at + 2 * HOUR, args: { campaignId } }]);

    // « Envoyer maintenant »: the preparation starts with the stored filter, the waiting call is cancelled.
    await w.as.mutation(api.features.campaigns.mutations.scheduleCampaign, {
      campaignId,
      scheduledAt: null,
    });
    campaign = await get(w, campaignId);
    expect(campaign.status).toBe('preparing');
    expect(campaign.scheduledAt).toBeUndefined();
    expect(campaign.scheduledFnId).toBeUndefined();
    expect((await jobs(w, 'startScheduledCampaign')).every((job) => job.state !== 'pending')).toBe(
      true,
    );
    const [prepare] = await jobs(w, 'prepareCampaignBatch');
    expect(prepare).toMatchObject({
      state: 'pending',
      args: { campaignId, filter: { isRedFlagged: true } },
    });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: { isRedFlagged: true } });
    const sends = await w.t.run((ctx) => ctx.db.query('campaignSends').collect());
    expect(sends.map((send) => send.email)).toEqual(['a@example.com']);
    expect(sends[0].sendAt).toBe(Date.now());
    expect((await get(w, campaignId)).status).toBe('sending');

    expect(await audits(w, campaignId)).toEqual([
      'schedule_cancelled',
      'scheduled',
      'scheduled',
      'started',
    ]);
  });

  test('its scheduled call starts it at its time, and does nothing once it was cancelled', async () => {
    const w = await setup();
    const at = NOW + 2 * DAY_MS;
    const campaignId = await create(w, { scheduledAt: at });
    pinClock(at);
    await w.t.mutation(fn.startScheduledCampaign, { campaignId });
    expect((await get(w, campaignId)).status).toBe('preparing');
    expect(await jobs(w, 'prepareCampaignBatch')).toEqual([
      { state: 'pending', at, args: { campaignId, filter: {} } },
    ]);

    const otherId = await create(w, { scheduledAt: at + DAY_MS });
    await w.as.mutation(api.features.campaigns.mutations.cancelScheduledCampaign, {
      campaignId: otherId,
    });
    await w.t.mutation(fn.startScheduledCampaign, { campaignId: otherId });
    expect((await get(w, otherId)).status).toBe('draft');
  });

  test('what the creation checked is checked again at the start: refused, the campaign goes back to draft with the code, and a new time clears it', async () => {
    const w = await setup();
    const at = NOW + DAY_MS;
    const campaignId = await create(w, { scheduledAt: at });
    pinClock(at);
    delete process.env.BREVO_API_KEY;
    await w.t.mutation(fn.startScheduledCampaign, { campaignId });
    const campaign = await get(w, campaignId);
    expect(campaign).toMatchObject({ status: 'draft', failureReason: 'email_provider_required' });
    expect(campaign.scheduledAt).toBeUndefined();
    expect(await jobs(w, 'prepareCampaignBatch')).toEqual([]);
    expect(await audits(w, campaignId)).toEqual(['start_refused']);
    process.env.BREVO_API_KEY = 'test-brevo-key';
    await w.as.mutation(api.features.campaigns.mutations.scheduleCampaign, {
      campaignId,
      scheduledAt: at + HOUR,
    });
    expect((await get(w, campaignId)).failureReason).toBeUndefined();
  });

  test('the overlay’s gate is asked again at the start, as at the creation; its refusal sends the campaign back to draft with its code', async () => {
    const w = await setup();
    const at = NOW + DAY_MS;
    const campaignId = await create(w, { scheduledAt: at });
    pinClock(at);
    const seen: string[] = [];
    setExtensionsForTests({
      beforeSend: async (_ctx, info) => {
        seen.push(info.source === 'campaign' ? `${info.stage}:${info.count}` : 'workflow');
        throw new ConvexError({ code: 'quota_exceeded' });
      },
    });
    try {
      await w.t.mutation(fn.startScheduledCampaign, { campaignId });
    } finally {
      setExtensionsForTests(defaultExtensions);
    }
    expect(seen).toEqual(['create:1']);
    expect(await get(w, campaignId)).toMatchObject({
      status: 'draft',
      failureReason: 'quota_exceeded',
    });
    expect(await jobs(w, 'prepareCampaignBatch')).toEqual([]);
  });

  test('a time in the past or beyond the year is refused, as is scheduling a campaign already on its way', async () => {
    const w = await setup();
    await expect(create(w, { scheduledAt: NOW })).rejects.toMatchObject({
      data: { code: 'schedule_time_invalid' },
    });
    await expect(create(w, { scheduledAt: NOW + 400 * DAY_MS })).rejects.toMatchObject({
      data: { code: 'schedule_time_invalid' },
    });
    const campaignId = await create(w);
    expect((await get(w, campaignId)).status).toBe('preparing');
    await expect(
      w.as.mutation(api.features.campaigns.mutations.scheduleCampaign, {
        campaignId,
        scheduledAt: NOW + DAY_MS,
      }),
    ).rejects.toMatchObject({ data: { code: 'campaign_not_schedulable' } });
    await expect(
      w.as.mutation(api.features.campaigns.mutations.cancelScheduledCampaign, { campaignId }),
    ).rejects.toMatchObject({ data: { code: 'campaign_not_scheduled' } });
    const scheduledId = await create(w, { scheduledAt: NOW + DAY_MS });
    await expect(
      w.as.mutation(api.features.campaigns.mutations.scheduleCampaign, {
        campaignId: scheduledId,
        scheduledAt: NOW - HOUR,
      }),
    ).rejects.toMatchObject({ data: { code: 'schedule_time_invalid' } });
  });
});
