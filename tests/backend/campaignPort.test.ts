import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { HTML_BODY_MAX_BYTES } from '../../convex/_lib/validators/crm';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 16, 10, 0, 0);
const HOUR = 3_600_000;
const fn = internal.features.campaigns.internal;

type World = { t: T; as: ReturnType<typeof asIdentity>; leadIds: Id<'leads'>[] };

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
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  await seedConfig(t);
  const as = asIdentity(t, emp.identity);
  const leadIds: Id<'leads'>[] = [];
  for (let i = 0; i < withoutEmail; i++) {
    await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Sans',
      lastName: `E${i}`,
      email: '',
    });
  }
  for (let i = 0; i < leads; i++) {
    leadIds.push(
      await as.mutation(api.features.leads.mutations.createLead, {
        firstName: 'Jean',
        lastName: `N${i}`,
        email: `lead${i}@example.com`,
      }),
    );
  }
  return { t, as, leadIds };
}

const create = (
  w: World,
  extra: Partial<
    Parameters<typeof w.as.mutation<typeof api.features.campaigns.mutations.createCampaign>>[1]
  > = {},
) =>
  w.as.mutation(api.features.campaigns.mutations.createCampaign, {
    name: 'Relance',
    channel: 'email',
    filter: {},
    subject: 'Bonjour',
    htmlBody: '<p>Bonjour</p>',
    messageType: 'transactional',
    ...extra,
  });

/** The preparation chain driven by hand: the recipients become sends, the drain stays scheduled and never runs, so nothing leaves. */
async function prepare(w: World, campaignId: Id<'campaigns'>) {
  const filter = (await get(w, campaignId)).filter ?? {};
  let cursor: string | undefined;
  for (;;) {
    const res = await w.t.mutation(fn.prepareCampaignBatch, {
      campaignId,
      filter,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    if (res.isDone) return;
    cursor = res.continueCursor ?? undefined;
  }
}

/** The scheduled calls of one function, with their state. */
const jobs = (w: World, name: string) =>
  w.t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.name.includes(name))
      .map((job) => job.state.kind),
  );

const get = (w: World, id: Id<'campaigns'>) =>
  w.t.run(async (ctx) => (await ctx.db.get(id)) as Doc<'campaigns'>);

const sendsOf = (w: World, id: Id<'campaigns'>) =>
  w.t.run((ctx) =>
    ctx.db
      .query('campaignSends')
      .withIndex('by_campaign', (q) => q.eq('campaignId', id))
      .collect(),
  );

/** A campaign prepared, its pending sends settled as the test wants them through the drain's own write, so the counters and the stats follow; a contact without an address is a skipped row. */
async function settled(w: World, statuses: ('sent' | 'failed')[]) {
  const id = await create(w);
  await prepare(w, id);
  const pending = (await sendsOf(w, id)).filter((s) => s.status === 'pending');
  await w.t.mutation(fn.recordSendResults, {
    campaignId: id,
    results: pending.map((send, i) => ({
      sendId: send._id,
      status: statuses[i % statuses.length],
      ...(statuses[i % statuses.length] === 'failed' ? { error: 'refused' } : {}),
    })),
  });
  await w.t.run((ctx) => ctx.db.patch(id, { status: 'sent' }));
  return id;
}

describe('deleting a campaign', () => {
  test('a settled campaign leaves the list, its sends stay', async () => {
    const w = await setup();
    const id = await settled(w, ['sent', 'sent', 'failed']);
    await w.as.mutation(api.features.campaigns.mutations.deleteCampaign, { campaignId: id });
    const campaign = await get(w, id);
    expect(campaign.deletedAt).toBeNumber();
    expect(await sendsOf(w, id)).toHaveLength(3);
    const page = await w.as.query(api.features.campaigns.queries.listCampaigns, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((c) => c._id)).not.toContain(id);
    await expect(
      w.as.mutation(api.features.campaigns.mutations.deleteCampaign, { campaignId: id }),
    ).rejects.toThrow(/campaign_not_found/);
  });

  test('a scheduled campaign loses its start; a sending one is refused', async () => {
    const w = await setup();
    const scheduled = await create(w, { scheduledAt: NOW + HOUR });
    expect((await get(w, scheduled)).status).toBe('scheduled');
    await w.as.mutation(api.features.campaigns.mutations.deleteCampaign, { campaignId: scheduled });
    expect((await get(w, scheduled)).scheduledFnId).toBeUndefined();
    expect(await jobs(w, 'startScheduledCampaign')).toEqual(['canceled']);
    expect(await sendsOf(w, scheduled)).toHaveLength(0);

    const sending = await create(w);
    await w.t.run((ctx) => ctx.db.patch(sending, { status: 'sending' }));
    await expect(
      w.as.mutation(api.features.campaigns.mutations.deleteCampaign, { campaignId: sending }),
    ).rejects.toThrow(/campaign_sending/);
  });
});

describe('« Relancer les échecs »', () => {
  test('re-queues the failed sends alone, keeps the sent count and the skipped in the failed one', async () => {
    const w = await setup(3, 1);
    const id = await settled(w, ['sent', 'failed', 'failed']);
    const count = await w.as.mutation(api.features.campaigns.mutations.resendAllCampaignSends, {
      campaignId: id,
      onlyFailed: true,
    });
    expect(count).toBe(2);
    const requeued = await w.t.mutation(fn.resendCampaignBatch, { campaignId: id, only: 'failed' });
    expect(requeued.isDone).toBe(true);
    const sends = await sendsOf(w, id);
    expect(sends.filter((s) => s.status === 'pending')).toHaveLength(2);
    expect(sends.filter((s) => s.status === 'sent')).toHaveLength(1);
    expect(sends.filter((s) => s.status === 'skipped_no_email')).toHaveLength(1);
    const campaign = await get(w, id);
    expect(campaign.sentCount).toBe(1);
    expect(campaign.failedCount).toBe(1);
    const audit = await w.t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).find(
        (a) => (a.metadata as { event?: string } | undefined)?.event === 'retry_failed',
      ),
    );
    expect(audit?.metadata).toEqual({ event: 'retry_failed', count: 2 });
  });

  test('is a no-op without a failure, the skipped rows not being failures', async () => {
    const w = await setup(1, 1);
    const id = await settled(w, ['sent']);
    const count = await w.as.mutation(api.features.campaigns.mutations.resendAllCampaignSends, {
      campaignId: id,
      onlyFailed: true,
    });
    expect(count).toBe(0);
    expect((await get(w, id)).status).toBe('sent');
    expect((await get(w, id)).failedCount).toBe(1);
  });
});

describe('the HTML body', () => {
  test('is refused past 800 KiB of UTF-8, the B body of a content test included', async () => {
    const w = await setup();
    // Three bytes a character: a body of 300 K characters is past the ceiling.
    const heavy = `<p>${'é'.repeat(HTML_BODY_MAX_BYTES / 2)}</p>`;
    await expect(create(w, { htmlBody: heavy })).rejects.toThrow(/html_body_too_large/);
    await expect(
      create(w, {
        abTest: {
          kind: 'content',
          htmlBodyB: heavy,
          splitPercent: 20,
          windowHours: 2,
          metric: 'opens',
        },
      }),
    ).rejects.toThrow(/html_body_too_large/);
  });
});

describe('a sample and exclusions', () => {
  test('the size and the base must be whole and ordered; the excluded campaigns must exist', async () => {
    const w = await setup();
    await expect(create(w, { sample: { size: 0, of: 3 } })).rejects.toThrow(
      /campaign_sample_invalid/,
    );
    await expect(create(w, { sample: { size: 4, of: 3 } })).rejects.toThrow(
      /campaign_sample_invalid/,
    );
    await expect(create(w, { sample: { size: 1.5, of: 3 } })).rejects.toThrow(
      /campaign_sample_invalid/,
    );
    const gone = await create(w, { scheduledAt: NOW + HOUR });
    await w.as.mutation(api.features.campaigns.mutations.deleteCampaign, { campaignId: gone });
    await expect(create(w, { excludeCampaignIds: [gone] })).rejects.toThrow(/campaign_not_found/);
  });

  test('the recipients of an excluded campaign are left out', async () => {
    const w = await setup(4);
    const first = await create(w, { filter: { search: 'N0' } });
    await prepare(w, first);
    expect(await sendsOf(w, first)).toHaveLength(1);
    const second = await create(w, { excludeCampaignIds: [first] });
    await prepare(w, second);
    const sends = await sendsOf(w, second);
    expect(sends).toHaveLength(3);
    expect(sends.map((s) => s.leadId)).not.toContain(w.leadIds[0]);
    expect((await get(w, second)).excludeCampaignIds).toEqual([first]);
  });

  test('the count and the sample work on the contacts left after the exclusions', async () => {
    const w = await setup(6);
    const first = await create(w, { filter: { search: 'N0' } });
    await prepare(w, first);
    const second = await create(w, { filter: { search: 'N1' } });
    await prepare(w, second);
    const counted = await w.as.query(api.features.leads.queries.matchingLeadsPage, {
      cursor: null,
      excludeCampaignIds: [first, second],
    });
    expect(counted.leadIds).toHaveLength(4);
    expect(counted.leadIds).not.toContain(w.leadIds[0]);
    // A sample of everyone left is exactly everyone left.
    const sampled = await create(w, {
      excludeCampaignIds: [first, second],
      sample: { size: 4, of: 4 },
    });
    await prepare(w, sampled);
    const sends = await sendsOf(w, sampled);
    expect(sends).toHaveLength(4);
    expect(sends.map((s) => s.leadId)).not.toContain(w.leadIds[0]);
    expect(sends.map((s) => s.leadId)).not.toContain(w.leadIds[1]);
  });

  test('a sample never exceeds its size, and reaches it when it asks for everyone', async () => {
    const w = await setup(6);
    const whole = await create(w, { sample: { size: 6, of: 6 } });
    await prepare(w, whole);
    expect(await sendsOf(w, whole)).toHaveLength(6);
    const two = await create(w, { sample: { size: 2, of: 6 } });
    await prepare(w, two);
    expect((await sendsOf(w, two)).length).toBeLessThanOrEqual(2);
    expect((await get(w, two)).totalCount).toBeLessThanOrEqual(2);
  });
});
