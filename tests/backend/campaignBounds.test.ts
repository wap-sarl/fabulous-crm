import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import { countDb } from '../support/dbCounter';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  seedLead,
} from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const RECIPIENTS = 50_000;

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

describe('a campaign of fifty thousand recipients', () => {
  test('opens, lists, resends and fails its pending sends with reads bounded by the page, never by the campaign', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
    await seedConfig(t);
    const as = asIdentity(t, emp.identity);
    const leadId = await seedLead(t, { email: 'ada@example.com' });
    const campaignId = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert('campaigns', {
        name: 'Grande',
        channel: 'email',
        subject: 'Bonjour',
        htmlBody: '<p>Bonjour</p>',
        status: 'sent',
        totalCount: RECIPIENTS,
        sentCount: RECIPIENTS,
        failedCount: 0,
        statsCountedThrough: 'all',
        updatedAt: NOW,
        createdBy: emp.userId,
      });
      for (let i = 0; i < RECIPIENTS; i++) {
        await ctx.db.insert('campaignSends', {
          campaignId,
          leadId,
          email: 'ada@example.com',
          params: { firstName: 'Ada' },
          status: 'sent',
          sentAt: NOW,
        });
      }
      return campaignId;
    });
    const sendsRead = (count: { reads: Record<string, number> }) => count.reads.campaignSends ?? 0;

    // The page: the campaign, its counters from their rows, then a page of sends and one of events.
    const opened = await countDb(() =>
      as.query(api.features.campaigns.queries.getCampaign, { campaignId }),
    );
    expect(sendsRead(opened)).toBe(0);
    const counters = () =>
      countDb(() => as.query(api.features.campaigns.queries.getCampaignStats, { campaignId }));
    const before = await counters();
    expect(sendsRead(before)).toBe(0);
    expect(before.reads.campaignStatShards).toBeUndefined();
    const listed = await countDb(() =>
      as.query(api.features.campaigns.queries.listCampaignSends, {
        campaignId,
        paginationOpts: { numItems: 50, cursor: null },
      }),
    );
    expect(sendsRead(listed)).toBe(50);

    // Resend all: the mutation re-queues nothing itself; each batch re-queues its page, and the campaign follows each send.
    const resent = await countDb(() =>
      as.mutation(api.features.campaigns.mutations.resendAllCampaignSends, { campaignId }),
    );
    expect(sendsRead(resent)).toBe(0);
    const batch = await countDb(() =>
      t.mutation(internal.features.campaigns.internal.resendCampaignBatch, { campaignId }),
    );
    // A page of 200: each send is read once for the page, once more by its patch and once by the trigger; the counters follow every send on their own rows, the campaign is written once.
    expect(sendsRead(batch)).toBeLessThanOrEqual(3 * 200);
    expect(batch.writes.campaignSends).toBe(200);
    expect(batch.reads.campaigns).toBeLessThanOrEqual(3 * 200 + 2);
    expect(batch.writes.campaigns).toBe(1);
    // Two hundred changes, all on the one row the transaction picked: it meets the provider events of that row only.
    expect(batch.writes.campaignStatShards).toBe(200);
    const afterBatch = await counters();
    expect(sendsRead(afterBatch)).toBe(0);
    expect(afterBatch.reads.campaignStatShards).toBe(1);

    // Fail what is pending: a batch, and the next one scheduled.
    await t.run((ctx) => ctx.db.patch(campaignId, { status: 'sending' }));
    const failed = await countDb(() =>
      t.mutation(internal.features.campaigns.internal.failPendingSends, {
        campaignId,
        error: 'no_provider',
      }),
    );
    expect(sendsRead(failed)).toBeLessThanOrEqual(3 * 200);
    expect(failed.writes.campaignSends).toBe(200);
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect()).filter(
        (job) => job.state.kind === 'pending' && job.name.includes('failPendingSends'),
      ),
    );
    expect(jobs.map((job) => job.args[0])).toEqual([{ campaignId, error: 'no_provider' }]);

    // Counting the campaign again: a page of 500 sends and the one after, which says where it stops; one row and the mark written.
    await t.mutation(internal.features.campaigns.internal.recountCampaignStats, { campaignId });
    const page = await countDb(() =>
      t.mutation(internal.features.campaigns.internal.countCampaignStatsPage, { campaignId }),
    );
    expect(sendsRead(page)).toBe(501);
    expect(page.writes).toEqual({ campaignStatShards: 1, campaigns: 1 });
  }, 120_000);
});
