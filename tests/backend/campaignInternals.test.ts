import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { WorkflowTrigger } from '../../convex/_lib/validators/workflows';
import { LINK_GRANT_MS } from '../../convex/_lib/validators/tracking';
import { readCampaignStats } from '../../convex/lib/campaigns/stats';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const fn = internal.features.campaigns.internal;

type World = { t: T; as: ReturnType<typeof asIdentity>; userId: Id<'users'> };

async function setup(): Promise<World> {
  const t = createTestConvex();
  pinClock(NOW);
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  return { t, as: asIdentity(t, emp.identity), userId: emp.userId };
}

let leadNumber = 0;
async function createLead(w: World, patch: Partial<Doc<'leads'>> = {}): Promise<Id<'leads'>> {
  leadNumber++;
  const leadId = await w.as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Jean',
    lastName: 'Dupont',
    email: `jean${leadNumber}@example.com`,
    phone: '+33612345678',
  });
  if (Object.keys(patch).length > 0) await w.t.run((ctx) => ctx.db.patch(leadId, patch));
  return leadId;
}

const insertCampaign = (w: World, overrides: Partial<Doc<'campaigns'>> = {}) =>
  w.t.run((ctx) =>
    ctx.db.insert('campaigns', {
      name: 'Relance',
      channel: 'email',
      status: 'sending',
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      updatedAt: NOW,
      createdBy: w.userId,
      ...overrides,
    }),
  );

const insertSend = (
  w: World,
  campaignId: Id<'campaigns'>,
  leadId: Id<'leads'>,
  overrides: Partial<Doc<'campaignSends'>> = {},
) =>
  w.t.run((ctx) =>
    ctx.db.insert('campaignSends', {
      campaignId,
      leadId,
      params: {},
      status: 'pending',
      ...overrides,
    }),
  );

const get = <Table extends 'leads' | 'campaigns' | 'campaignSends' | 'campaignLinkTokens'>(
  w: World,
  id: Id<Table>,
) => w.t.run(async (ctx) => (await ctx.db.get(id)) as Doc<Table>);

const eventsOf = (w: World, sendId: Id<'campaignSends'>) =>
  w.t.run((ctx) =>
    ctx.db
      .query('campaignEvents')
      .withIndex('by_send', (q) => q.eq('sendId', sendId))
      .collect(),
  );

const notesOf = (w: World, leadId: Id<'leads'>) =>
  w.t.run(async (ctx) =>
    (await ctx.db.query('leadNotes').collect()).filter((n) => n.leadId === leadId),
  );

const auditsOf = (w: World, leadId: Id<'leads'>, source: string) =>
  w.t.run(async (ctx) =>
    (await ctx.db.query('auditLogs').collect()).filter(
      (a) => a.entityId === leadId && (a.metadata as { source?: string })?.source === source,
    ),
  );

/** What is scheduled and has not run, by the name of its function. */
const jobsNamed = (w: World, name: string) =>
  w.t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.state.kind === 'pending' && job.name.includes(name))
      .map((job) => job.args[0] as Record<string, unknown>),
  );

/** An active workflow that enrolls on `trigger`; its runs say which events reached the workflows. */
async function listening(w: World, trigger: WorkflowTrigger) {
  const workflowId = await w.t.run((ctx) =>
    ctx.db.insert('workflows', {
      name: 'Écoute',
      status: 'active',
      trigger,
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
      enrolledCount: 0,
      activeCount: 0,
      completedCount: 0,
      updatedAt: NOW,
      createdBy: w.userId,
    }),
  );
  return () =>
    w.t.run(async (ctx) =>
      (
        await ctx.db
          .query('workflowRuns')
          .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
          .collect()
      ).map((run) => run.leadId),
    );
}

describe('campaign sends: the drain', () => {
  test('the next batch is fifty pending sends at most, with what the action needs', async () => {
    const w = await setup();
    const leadId = await createLead(w);
    const campaignId = await insertCampaign(w, {
      subject: 'Bonjour',
      htmlBody: '<p>x</p>',
      messageType: 'marketing',
    });
    const first = await insertSend(w, campaignId, leadId, {
      email: 'a@example.com',
      params: { firstName: 'Jean' },
    });
    for (let i = 0; i < 51; i++) await insertSend(w, campaignId, leadId);
    await insertSend(w, campaignId, leadId, { status: 'sent' });

    const batch = await w.t.query(fn.getPendingSends, { campaignId });
    expect(batch).toMatchObject({
      channel: 'email',
      subject: 'Bonjour',
      htmlBody: '<p>x</p>',
      messageType: 'marketing',
    });
    expect(batch?.sends).toHaveLength(50);
    expect(batch?.sends[0]).toEqual({
      sendId: first,
      email: 'a@example.com',
      phone: undefined,
      params: { firstName: 'Jean' },
    });

    await w.t.run((ctx) => ctx.db.delete(campaignId));
    expect(await w.t.query(fn.getPendingSends, { campaignId })).toBeNull();
  });

  test('the results of a batch are written on the sends, counted on the campaign, and a send that left is an activity', async () => {
    const w = await setup();
    const reached = await createLead(w);
    const missed = await createLead(w);
    const campaignId = await insertCampaign(w, { sentCount: 2, failedCount: 1 });
    const sent = await insertSend(w, campaignId, reached);
    const failed = await insertSend(w, campaignId, missed);

    await w.t.mutation(fn.recordSendResults, {
      campaignId,
      results: [
        { sendId: sent, status: 'sent', brevoMessageId: 'm-1' },
        { sendId: failed, status: 'failed', error: 'refused' },
      ],
    });
    expect(await get(w, sent)).toMatchObject({
      status: 'sent',
      brevoMessageId: 'm-1',
      sentAt: NOW,
    });
    expect(await get(w, failed)).toMatchObject({ status: 'failed', error: 'refused', sentAt: NOW });
    expect(await get(w, campaignId)).toMatchObject({
      sentCount: 3,
      failedCount: 2,
      updatedAt: NOW,
    });
    expect((await get(w, reached)).lastActivityAt).toBe(NOW);
    expect((await get(w, missed)).lastActivityAt).toBeUndefined();
  });

  test('a campaign ends sent when something left, failed when nothing did', async () => {
    const w = await setup();
    const some = await insertCampaign(w, { sentCount: 1 });
    const none = await insertCampaign(w, { sentCount: 0 });
    await w.t.mutation(fn.markCampaignComplete, { campaignId: some });
    await w.t.mutation(fn.markCampaignComplete, { campaignId: none });
    expect((await get(w, some)).status).toBe('sent');
    expect((await get(w, none)).status).toBe('failed');
    await w.t.run((ctx) => ctx.db.delete(none));
    await w.t.mutation(fn.markCampaignComplete, { campaignId: none });
  });

  test('failing what is pending leaves the rest alone, counts once, and completes the campaign', async () => {
    const w = await setup();
    const leadId = await createLead(w);
    const campaignId = await insertCampaign(w, { sentCount: 1, failedCount: 1 });
    const pending = [
      await insertSend(w, campaignId, leadId),
      await insertSend(w, campaignId, leadId),
    ];
    const sent = await insertSend(w, campaignId, leadId, { status: 'sent' });

    expect(await w.t.mutation(fn.failPendingSends, { campaignId, error: 'no_provider' })).toEqual({
      failed: 2,
      isDone: true,
    });
    for (const id of pending) {
      expect(await get(w, id)).toMatchObject({ status: 'failed', error: 'no_provider' });
    }
    expect((await get(w, sent)).status).toBe('sent');
    expect(await get(w, campaignId)).toMatchObject({ failedCount: 3, status: 'sent' });
    expect(await w.t.mutation(fn.failPendingSends, { campaignId, error: 'again' })).toEqual({
      failed: 0,
      isDone: true,
    });
    expect((await get(w, campaignId)).failedCount).toBe(3);
    expect(await jobsNamed(w, 'failPendingSends')).toEqual([]);
  });

  test('more pending sends than a batch takes are failed by the next batch, scheduled with the same words', async () => {
    const w = await setup();
    const leadId = await createLead(w);
    const campaignId = await insertCampaign(w);
    for (let i = 0; i < 3; i++) await insertSend(w, campaignId, leadId);
    const args = { campaignId, error: 'no_provider', batchSize: 2 };

    expect(await w.t.mutation(fn.failPendingSends, args)).toEqual({ failed: 2, isDone: false });
    expect(await jobsNamed(w, 'failPendingSends')).toEqual([args]);
    expect(await get(w, campaignId)).toMatchObject({ failedCount: 2, status: 'sending' });

    expect(await w.t.mutation(fn.failPendingSends, args)).toEqual({ failed: 1, isDone: true });
    expect(await jobsNamed(w, 'failPendingSends')).toHaveLength(1);
    // Nothing left, and the campaign ends failed: nothing had left.
    expect(await get(w, campaignId)).toMatchObject({ failedCount: 3, status: 'failed' });
  });
});

describe('campaign sends: the resend of all', () => {
  const link = {
    key: 'oui',
    label: 'Oui',
    target: { kind: 'standard' as const, field: 'comment' as const },
    value: 'intéressé',
    redirectUrl: 'https://example.com/merci',
  };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    // A Brevo key makes the e-mail provider configured, and tracked links need their base: a resend checks both.
    for (const [name, value] of [
      ['BREVO_API_KEY', 'test-brevo-key'],
      ['CONVEX_SITE_URL', 'https://site.example'],
    ]) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** A sent campaign of four: one delivered and opened, one failed, one skipped who has an address since, one skipped who still has none. */
  async function sentCampaign(w: World) {
    const opened = await createLead(w);
    const missed = await createLead(w);
    const reachable = await createLead(w);
    const unreachable = await createLead(w, { email: undefined });
    const campaignId = await insertCampaign(w, {
      status: 'sent',
      trackedLinks: [link],
      totalCount: 4,
      sentCount: 1,
      failedCount: 3,
      failureReason: 'quota_exceeded',
      linksPurgedAt: NOW - 1,
      statsCountedThrough: 'all',
    });
    const sends = {
      opened: await insertSend(w, campaignId, opened, {
        status: 'sent',
        email: 'a@example.com',
        brevoMessageId: 'm-1',
        sentAt: NOW - 1,
        openedAt: NOW,
      }),
      missed: await insertSend(w, campaignId, missed, {
        status: 'failed',
        email: 'b@example.com',
        error: 'refused',
        sentAt: NOW - 1,
      }),
      reachable: await insertSend(w, campaignId, reachable, { status: 'skipped_no_email' }),
      unreachable: await insertSend(w, campaignId, unreachable, { status: 'skipped_no_email' }),
    };
    return { campaignId, sends };
  }
  const resendAll = (w: World, campaignId: Id<'campaigns'>) =>
    w.as.mutation(api.features.campaigns.mutations.resendAllCampaignSends, { campaignId });

  test('the sends are re-queued page by page, the drain follows the last page, and the campaign reads preparing meanwhile', async () => {
    const w = await setup();
    const { campaignId, sends } = await sentCampaign(w);

    expect(await resendAll(w, campaignId)).toBeNull();
    expect(await get(w, campaignId)).toMatchObject({
      status: 'preparing',
      sentCount: 0,
      failedCount: 0,
      totalCount: 4,
    });
    expect((await get(w, campaignId)).failureReason).toBeUndefined();
    // Links come back with the sends: the purge will see the campaign again.
    expect((await get(w, campaignId)).linksPurgedAt).toBeUndefined();
    expect(await jobsNamed(w, 'resendCampaignBatch')).toEqual([{ campaignId }]);
    // Nothing is re-queued by the mutation itself.
    expect((await get(w, sends.opened)).status).toBe('sent');

    const first = await w.t.mutation(fn.resendCampaignBatch, { campaignId, batchSize: 3 });
    expect(first.isDone).toBe(false);
    expect(await jobsNamed(w, 'resendCampaignBatch')).toEqual([
      { campaignId },
      { campaignId, cursor: first.continueCursor, resent: 3, batchSize: 3 },
    ]);
    expect(await get(w, campaignId)).toMatchObject({ status: 'preparing', failedCount: 0 });
    expect(await jobsNamed(w, 'actions:sendCampaignBatch')).toEqual([]);
    // What the first send had earned is forgotten; the skipped one got an address, a contact and a token.
    expect(await get(w, sends.opened)).toMatchObject({ status: 'pending', email: 'a@example.com' });
    expect((await get(w, sends.opened)).openedAt).toBeUndefined();
    expect((await get(w, sends.opened)).sentAt).toBeUndefined();
    expect((await get(w, sends.missed)).error).toBeUndefined();
    const reachable = await get(w, sends.reachable);
    expect(reachable).toMatchObject({
      status: 'pending',
      email: `jean${leadNumber - 1}@example.com`,
    });
    expect(reachable.params.oui).toMatch(/^https:\/\/site\.example\/l\/[0-9a-f]{16}$/);
    const tokens = await w.t.run((ctx) => ctx.db.query('campaignLinkTokens').collect());
    expect(tokens.map((t) => t.sendId)).toEqual([sends.reachable]);

    const last = await w.t.mutation(fn.resendCampaignBatch, {
      campaignId,
      cursor: first.continueCursor ?? undefined,
      resent: 3,
      batchSize: 3,
    });
    expect(last.isDone).toBe(true);
    expect((await get(w, sends.unreachable)).status).toBe('skipped_no_email');
    expect(await get(w, campaignId)).toMatchObject({
      status: 'sending',
      sentCount: 0,
      failedCount: 1,
      updatedAt: NOW,
    });
    expect(await jobsNamed(w, 'failPendingSends')).toEqual([]);
    expect(await jobsNamed(w, 'actions:sendCampaignBatch')).toEqual([{ campaignId }]);
    expect(await jobsNamed(w, 'resendCampaignBatch')).toHaveLength(2);
    // The counters followed the three re-queued sends; the seeded one that stayed skipped never changed, so they never saw it.
    expect(await w.t.run((ctx) => readCampaignStats(ctx, campaignId))).toMatchObject({
      pending: 3,
      opened: 0,
      sentByHour: {},
    });
    const audits = await w.t.run((ctx) => ctx.db.query('auditLogs').collect());
    expect(audits.at(-1)).toMatchObject({
      entityType: 'campaign',
      entityId: campaignId,
      metadata: { event: 'resend_all', count: 4 },
    });
  });

  test('a campaign with nobody to reach ends sent without a drain; one that is deleted, or being sent, stops the chain', async () => {
    const w = await setup();
    const nobody = await createLead(w, { email: undefined });
    const campaignId = await insertCampaign(w, { status: 'failed', totalCount: 1, failedCount: 1 });
    await insertSend(w, campaignId, nobody, { status: 'skipped_no_email' });
    await resendAll(w, campaignId);
    expect(await w.t.mutation(fn.resendCampaignBatch, { campaignId })).toEqual({
      isDone: true,
      continueCursor: expect.any(String),
    });
    expect(await get(w, campaignId)).toMatchObject({ status: 'sent', failedCount: 1 });
    expect(await jobsNamed(w, 'actions:sendCampaignBatch')).toEqual([]);

    const sending = await insertCampaign(w, { status: 'sending', totalCount: 1 });
    expect(await w.t.mutation(fn.resendCampaignBatch, { campaignId: sending })).toEqual({
      isDone: true,
      continueCursor: null,
    });
    await w.t.run((ctx) => ctx.db.delete(sending));
    expect(await w.t.mutation(fn.resendCampaignBatch, { campaignId: sending })).toEqual({
      isDone: true,
      continueCursor: null,
    });
  });

  test('a resend is refused while one runs, and does nothing to a campaign without recipients', async () => {
    const w = await setup();
    const { campaignId, sends } = await sentCampaign(w);
    await resendAll(w, campaignId);
    await expect(resendAll(w, campaignId)).rejects.toThrow(/campaign_sending/);
    await expect(
      w.as.mutation(api.features.campaigns.mutations.retryCampaignSend, {
        campaignId,
        sendId: sends.missed,
      }),
    ).rejects.toThrow(/campaign_sending/);

    const empty = await insertCampaign(w, { status: 'sent' });
    expect(await resendAll(w, empty)).toBeNull();
    expect(await get(w, empty)).toMatchObject({ status: 'sent' });
    expect(await jobsNamed(w, 'resendCampaignBatch')).toHaveLength(1);
  });
});

describe('campaign events: e-mail', () => {
  async function sentEmail(w: World, lead: Partial<Doc<'leads'>> = {}) {
    const leadId = await createLead(w, lead);
    const campaignId = await insertCampaign(w);
    const sendId = await insertSend(w, campaignId, leadId, {
      status: 'sent',
      brevoMessageId: 'm-1',
    });
    const event = (type: Doc<'campaignEvents'>['type'], eventAt: number, extra = {}) =>
      w.t.mutation(fn.recordBrevoEmailEvent, { brevoMessageId: 'm-1', type, eventAt, ...extra });
    return { leadId, campaignId, sendId, event };
  }

  test('an open and a click are logged each time, stamped on the send the first time, and counted on the contact', async () => {
    const w = await setup();
    const { leadId, campaignId, sendId, event } = await sentEmail(w);
    const opened = await listening(w, { type: 'campaign_email_event', event: 'opened' });
    const clicked = await listening(w, {
      type: 'campaign_email_event',
      event: 'clicked',
      campaignId,
    });
    const sms = await listening(w, { type: 'campaign_sms_event', event: 'delivered' });

    await event('opened', NOW + 1);
    await event('opened', NOW + 2);
    await event('clicked', NOW + 3, { url: 'https://example.com/a' });
    await event('clicked', NOW + 4);
    await event('delivered', NOW + 5);

    expect((await eventsOf(w, sendId)).map((e) => [e.type, e.eventAt, e.url ?? null])).toEqual([
      ['opened', NOW + 1, null],
      ['opened', NOW + 2, null],
      ['clicked', NOW + 3, 'https://example.com/a'],
      ['clicked', NOW + 4, null],
      ['delivered', NOW + 5, null],
    ]);
    expect(await get(w, sendId)).toMatchObject({ openedAt: NOW + 1, clickedAt: NOW + 3 });
    expect(await get(w, leadId)).toMatchObject({
      emailOpenCount: 2,
      lastEmailOpenAt: NOW + 2,
      emailClickCount: 2,
      lastEmailClickAt: NOW + 4,
      lastActivityAt: NOW + 4,
    });
    expect(await opened()).toEqual([leadId]);
    expect(await clicked()).toEqual([leadId]);
    expect(await sms()).toEqual([]);
  });

  test('the same event at the same time is a replay: one row, one count, one trigger', async () => {
    const w = await setup();
    const { leadId, sendId, event } = await sentEmail(w);
    const bounced = await listening(w, { type: 'campaign_email_event', event: 'hard_bounce' });
    await event('opened', NOW + 1);
    await event('opened', NOW + 1);
    await event('hard_bounce', NOW + 2, { reason: 'mailbox full' });
    await event('hard_bounce', NOW + 2, { reason: 'mailbox full' });
    const events = await eventsOf(w, sendId);
    expect(events.map((e) => e.type)).toEqual(['opened', 'hard_bounce']);
    expect(events[1].reason).toBe('mailbox full');
    expect((await get(w, leadId)).emailOpenCount).toBe(1);
    expect(await bounced()).toEqual([leadId]);
  });

  test('a contact who objected to profiling leaves no open and no click, the mail events stay', async () => {
    const w = await setup();
    const { leadId, sendId, event } = await sentEmail(w, { excludeFromProfiling: true });
    const opened = await listening(w, { type: 'campaign_email_event', event: 'opened' });
    await event('opened', NOW + 1);
    await event('clicked', NOW + 2);
    await event('delivered', NOW + 3);
    expect((await eventsOf(w, sendId)).map((e) => e.type)).toEqual(['delivered']);
    const send = await get(w, sendId);
    expect(send.openedAt).toBeUndefined();
    expect(send.clickedAt).toBeUndefined();
    expect((await get(w, leadId)).emailOpenCount).toBeUndefined();
    expect(await opened()).toEqual([]);
  });

  test('an event for a message no send carries is dropped', async () => {
    const w = await setup();
    const { sendId } = await sentEmail(w);
    await w.t.mutation(fn.recordBrevoEmailEvent, {
      brevoMessageId: 'unknown',
      type: 'opened',
      eventAt: NOW,
    });
    expect(await eventsOf(w, sendId)).toEqual([]);
  });
});

describe('campaign events: text messages', () => {
  async function sentSms(w: World, lead: Partial<Doc<'leads'>> = {}) {
    const leadId = await createLead(w, { marketingConsent: ['email', 'sms'], ...lead });
    const campaignId = await insertCampaign(w, { channel: 'sms' });
    const sendId = await insertSend(w, campaignId, leadId, {
      status: 'sent',
      brevoMessageId: 'sms-1',
      phone: '+33612345678',
      smsRecipient: '33612345678',
    });
    const event = (msgStatus: string, eventAt: number, by: { recipient?: string } = {}) =>
      w.t.mutation(fn.handleSmsEvent, {
        ...(by.recipient ? { recipient: by.recipient } : { brevoMessageId: 'sms-1' }),
        msgStatus,
        eventAt,
      });
    return { leadId, campaignId, sendId, event };
  }

  test('a status is logged, stamped on the send the first time, and reaches the workflows of text messages', async () => {
    const w = await setup();
    const { leadId, sendId, event } = await sentSms(w);
    const delivered = await listening(w, { type: 'campaign_sms_event', event: 'delivered' });
    const replied = await listening(w, { type: 'campaign_sms_event', event: 'sms_reply' });
    const email = await listening(w, { type: 'campaign_email_event', event: 'delivered' });

    await event('delivered', NOW + 1);
    await event('delivered', NOW + 2);
    await event('replied', NOW + 3);
    await event('soft_bounce', NOW + 4);
    await event('hard_bounce', NOW + 5);
    await event('accepted', NOW + 6);

    expect((await eventsOf(w, sendId)).map((e) => [e.type, e.eventAt])).toEqual([
      ['delivered', NOW + 1],
      ['delivered', NOW + 2],
      ['sms_reply', NOW + 3],
      ['soft_bounce', NOW + 4],
      ['hard_bounce', NOW + 5],
    ]);
    const send = await get(w, sendId);
    expect(send).toMatchObject({ deliveredAt: NOW + 1, repliedAt: NOW + 3, bouncedAt: NOW + 4 });
    expect(send.unsubscribedAt).toBeUndefined();
    // A reply is an activity of the contact; a delivery is not.
    expect((await get(w, leadId)).lastActivityAt).toBe(NOW + 3);
    expect(await delivered()).toEqual([leadId]);
    expect(await replied()).toEqual([leadId]);
    expect(await email()).toEqual([]);
    expect((await get(w, leadId)).marketingConsent).toEqual(['email', 'sms']);
  });

  for (const status of ['unsubscribed', 'bl']) {
    test(`a STOP (${status}) found by the number withdraws the consent to text messages, once`, async () => {
      const w = await setup();
      const { leadId, sendId, event } = await sentSms(w);
      const stopped = await listening(w, { type: 'campaign_sms_event', event: 'stop' });
      const consent = await listening(w, { type: 'consent_updated' });

      // A STOP comes with an id of its own and the number, written as the operator likes.
      await event(status, NOW + 1, { recipient: '+33 6 12 34 56 78' });
      const lead = await get(w, leadId);
      expect(lead).toMatchObject({
        marketingConsent: ['email'],
        consentSource: 'sms_stop',
        consentUpdatedAt: NOW,
      });
      expect((await get(w, sendId)).unsubscribedAt).toBe(NOW + 1);
      const audits = await auditsOf(w, leadId, 'sms_stop');
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ entityType: 'lead', action: 'update' });
      expect(audits[0].userId).toBeUndefined();
      expect((audits[0].metadata as { changes: object }).changes).toHaveProperty(
        'marketingConsent',
      );
      const notes = await notesOf(w, leadId);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        content: 'Désinscription SMS : le contact a répondu STOP (événement Brevo).',
        isPinned: false,
      });
      expect(notes[0].createdBy).toBeUndefined();
      expect(await consent()).toEqual([leadId]);
      expect(await stopped()).toEqual(status === 'unsubscribed' ? [leadId] : []);

      await event(status, NOW + 1, { recipient: '33612345678' });
      await event(status, NOW + 9, { recipient: '33612345678' });
      expect(await auditsOf(w, leadId, 'sms_stop')).toHaveLength(1);
      expect(await notesOf(w, leadId)).toHaveLength(1);
      expect((await get(w, sendId)).unsubscribedAt).toBe(NOW + 1);
    });
  }

  test('a STOP of a deleted contact, and a status no send answers to, change nothing', async () => {
    const w = await setup();
    const { leadId, sendId, event } = await sentSms(w, { deletedAt: NOW });
    await event('unsubscribed', NOW + 1);
    expect((await get(w, leadId)).marketingConsent).toEqual(['email', 'sms']);
    expect(await notesOf(w, leadId)).toEqual([]);
    expect((await eventsOf(w, sendId)).map((e) => e.type)).toEqual(['unsubscribed']);

    await event('unsubscribed', NOW + 2, { recipient: '+33 7 00 00 00 00' });
    await w.t.mutation(fn.handleSmsEvent, {
      brevoMessageId: 'unknown',
      msgStatus: 'delivered',
      eventAt: NOW + 3,
    });
    expect(await eventsOf(w, sendId)).toHaveLength(1);
  });
});

describe('campaign preparation: tracked links', () => {
  const link = {
    key: 'oui',
    label: 'Oui',
    target: { kind: 'standard' as const, field: 'comment' as const },
    value: 'intéressé',
    redirectUrl: 'https://example.com/merci',
  };

  test('a send that goes out gets a token per link and its address in the placeholders; a skipped one gets none', async () => {
    const w = await setup();
    const reached = await createLead(w);
    const unreachable = await createLead(w, { email: undefined });
    const campaignId = await insertCampaign(w, { status: 'preparing', trackedLinks: [link] });

    const result = await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    expect(result.isDone).toBe(true);
    const sends = await w.t.run((ctx) => ctx.db.query('campaignSends').collect());
    const tokens = await w.t.run((ctx) => ctx.db.query('campaignLinkTokens').collect());
    const sent = sends.find((s) => s.leadId === reached);
    const skipped = sends.find((s) => s.leadId === unreachable);
    expect(sent?.status).toBe('pending');
    expect(skipped?.status).toBe('skipped_no_email');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      campaignId,
      sendId: sent?._id,
      leadId: reached,
      linkKey: 'oui',
    });
    expect(tokens[0].token).toMatch(/^[0-9a-f]{16}$/);
    expect(sent?.params.oui).toBe(`${process.env.CONVEX_SITE_URL}/l/${tokens[0].token}`);
    expect(sent?.params).toMatchObject({ firstName: 'Jean', lastName: 'Dupont' });
    // The skipped send has the placeholder too, to a token nothing answers to.
    expect(skipped?.params.oui).toMatch(/\/l\/[0-9a-f]{16}$/);
    expect(skipped?.params.oui).not.toBe(sent?.params.oui);
    expect(await get(w, campaignId)).toMatchObject({
      status: 'sending',
      totalCount: 2,
      failedCount: 1,
    });
  });

  test('a text message campaign writes the number as the provider sends it back, and skips who has none', async () => {
    const w = await setup();
    const reached = await createLead(w);
    const unreachable = await createLead(w, { phone: undefined });
    const campaignId = await insertCampaign(w, { status: 'preparing', channel: 'sms' });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const sends = await w.t.run((ctx) => ctx.db.query('campaignSends').collect());
    const sent = sends.find((s) => s.leadId === reached);
    expect(sent).toMatchObject({
      status: 'pending',
      phone: '+33612345678',
      smsRecipient: '33612345678',
    });
    expect(sent?.email).toBeUndefined();
    expect(sends.find((s) => s.leadId === unreachable)?.status).toBe('skipped_no_phone');
  });

  test('a campaign with nobody to reach ends sent, and one that is no longer preparing is left alone', async () => {
    const w = await setup();
    await createLead(w, { email: undefined });
    const empty = await insertCampaign(w, { status: 'preparing' });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId: empty, filter: {} });
    expect(await get(w, empty)).toMatchObject({ status: 'sent', totalCount: 1, failedCount: 1 });

    const sending = await insertCampaign(w, { status: 'sending' });
    expect(
      await w.t.mutation(fn.prepareCampaignBatch, { campaignId: sending, filter: {} }),
    ).toEqual({
      isDone: true,
      continueCursor: null,
    });
    expect(await get(w, sending)).toMatchObject({ status: 'sending', totalCount: 0 });
  });

  test('a click writes the value on the contact, notes the first one and logs each', async () => {
    const w = await setup();
    const leadId = await createLead(w);
    const campaignId = await insertCampaign(w, { status: 'preparing', trackedLinks: [link] });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const [token] = await w.t.run((ctx) => ctx.db.query('campaignLinkTokens').collect());
    const clicks = await listening(w, { type: 'tracked_link_click', campaignId });
    const changes = await listening(w, { type: 'lead_property_changed' });

    expect(await w.t.mutation(fn.handleTrackedLinkClick, { token: 'nope' })).toEqual({
      found: false,
    });
    const first = await w.t.mutation(fn.handleTrackedLinkClick, { token: token.token });
    expect(first).toEqual({
      found: true,
      redirectUrl: 'https://example.com/merci',
      identify: false,
    });
    expect((await get(w, leadId)).comment).toBe('intéressé');
    expect((await get(w, token._id)).clickedAt).toBe(NOW);
    expect((await get(w, token.sendId)).clickedAt).toBe(NOW);
    const audits = await auditsOf(w, leadId, 'tracked_link');
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({
      campaignId,
      changes: { comment: { new: 'intéressé' } },
    });
    expect((await notesOf(w, leadId)).map((n) => n.content)).toEqual([
      'Lien cliqué : Oui (campagne « Relance »).',
    ]);
    expect(await clicks()).toEqual([leadId]);
    expect(await changes()).toEqual([leadId]);

    pinClock(NOW + 60_000);
    await w.t.mutation(fn.handleTrackedLinkClick, { token: token.token });
    expect((await get(w, token._id)).clickedAt).toBe(NOW);
    expect((await get(w, token.sendId)).clickedAt).toBe(NOW);
    const events = await eventsOf(w, token.sendId);
    expect(events.map((e) => [e.type, e.eventAt, e.linkKey, e.linkLabel])).toEqual([
      ['link_click', NOW, 'oui', 'Oui'],
      ['link_click', NOW + 60_000, 'oui', 'Oui'],
    ]);
    expect(await auditsOf(w, leadId, 'tracked_link')).toHaveLength(1);
    expect(await notesOf(w, leadId)).toHaveLength(1);
  });

  test('a click of a contact who objected, or who was deleted, still leads where the link goes', async () => {
    const w = await setup();
    const objector = await createLead(w, { excludeFromProfiling: true });
    const deleted = await createLead(w);
    const campaignId = await insertCampaign(w, { status: 'preparing', trackedLinks: [link] });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    await w.t.run((ctx) => ctx.db.patch(deleted, { deletedAt: NOW }));
    const tokens = await w.t.run((ctx) => ctx.db.query('campaignLinkTokens').collect());
    const tokenOf = (leadId: Id<'leads'>) => tokens.find((t) => t.leadId === leadId)!;

    const objected = await w.t.mutation(fn.handleTrackedLinkClick, {
      token: tokenOf(objector).token,
    });
    expect(objected).toEqual({
      found: true,
      redirectUrl: 'https://example.com/merci',
      identify: false,
    });
    expect((await get(w, tokenOf(objector)._id)).clickedAt).toBeUndefined();
    expect(await eventsOf(w, tokenOf(objector).sendId)).toEqual([]);
    expect((await get(w, objector)).comment).toBeUndefined();

    const gone = await w.t.mutation(fn.handleTrackedLinkClick, { token: tokenOf(deleted).token });
    expect(gone).toMatchObject({ found: true, redirectUrl: 'https://example.com/merci' });
    expect((await get(w, deleted)).comment).toBeUndefined();
    expect(await notesOf(w, deleted)).toEqual([]);
    expect(await eventsOf(w, tokenOf(deleted).sendId)).toHaveLength(1);
  });

  test('the preparation reaches the contacts its creator can see, all of them when it has no creator', async () => {
    const w = await setup();
    const other = await seedEmployee(w.t, { email: 'other@example.com' });
    const own = await createLead(w, { ownerIds: [w.userId] });
    const pool = await createLead(w);
    const theirs = await createLead(w, { ownerIds: [other.userId] });
    const reachedBy = async (campaignId: Id<'campaigns'>) => {
      await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
      const sends = await w.t.run((ctx) => ctx.db.query('campaignSends').collect());
      return sends.filter((s) => s.campaignId === campaignId).map((s) => s.leadId);
    };
    const scoped = await insertCampaign(w, { status: 'preparing' });
    expect((await reachedBy(scoped)).sort()).toEqual([own, pool].sort());
    const system = await insertCampaign(w, { status: 'preparing', createdBy: undefined });
    expect((await reachedBy(system)).sort()).toEqual([own, pool, theirs].sort());
  });

  test('each page schedules the next as it was asked, the last one schedules the drain, and nothing to send schedules nothing', async () => {
    const w = await setup();
    for (let i = 0; i < 3; i++) await createLead(w);
    const filter = { isRedFlagged: false };
    const campaignId = await insertCampaign(w, { status: 'preparing' });

    const first = await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter, batchSize: 2 });
    expect(first.isDone).toBe(false);
    expect(await jobsNamed(w, 'prepareCampaignBatch')).toEqual([
      { campaignId, filter, cursor: first.continueCursor, batchSize: 2 },
    ]);
    expect(await jobsNamed(w, 'actions:sendCampaignBatch')).toEqual([]);
    expect(await get(w, campaignId)).toMatchObject({ status: 'preparing', totalCount: 2 });

    const last = await w.t.mutation(fn.prepareCampaignBatch, {
      campaignId,
      filter,
      cursor: first.continueCursor ?? undefined,
      batchSize: 2,
    });
    expect(last.isDone).toBe(true);
    expect(await jobsNamed(w, 'prepareCampaignBatch')).toHaveLength(1);
    expect(await jobsNamed(w, 'actions:sendCampaignBatch')).toEqual([{ campaignId }]);
    expect(await get(w, campaignId)).toMatchObject({ status: 'sending', totalCount: 3 });

    const nobody = await insertCampaign(w, { status: 'preparing' });
    await w.t.mutation(fn.prepareCampaignBatch, {
      campaignId: nobody,
      filter: { isRedFlagged: true },
    });
    expect(await get(w, nobody)).toMatchObject({ status: 'sent', totalCount: 0 });
    expect(await jobsNamed(w, 'actions:sendCampaignBatch')).toHaveLength(1);
  });

  test('a click on a value the contact already has is logged and noted, and changes nothing', async () => {
    const w = await setup();
    const leadId = await createLead(w, { comment: 'intéressé' });
    const campaignId = await insertCampaign(w, { status: 'preparing', trackedLinks: [link] });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const [token] = await w.t.run((ctx) => ctx.db.query('campaignLinkTokens').collect());
    const thisLink = await listening(w, { type: 'tracked_link_click', linkKey: 'oui' });
    const otherLink = await listening(w, { type: 'tracked_link_click', linkKey: 'non' });
    const otherCampaign = await listening(w, {
      type: 'tracked_link_click',
      campaignId: await insertCampaign(w),
    });
    const changes = await listening(w, { type: 'lead_property_changed' });

    await w.t.mutation(fn.handleTrackedLinkClick, { token: token.token });
    expect(await thisLink()).toEqual([leadId]);
    expect(await otherLink()).toEqual([]);
    expect(await otherCampaign()).toEqual([]);
    expect(await changes()).toEqual([]);
    expect(await auditsOf(w, leadId, 'tracked_link')).toEqual([]);
    expect(await eventsOf(w, token.sendId)).toHaveLength(1);
    expect(await notesOf(w, leadId)).toHaveLength(1);
  });

  test('in named tracking a click identifies the browser only with a grant, on a tracked site, for a short while', async () => {
    const w = await setup();
    await seedConfig(w.t, {
      tracking: {
        enabled: true,
        mode: 'named',
        retentionDays: 90,
        allowedOrigins: ['https://example.com'],
        privacyUrl: 'https://example.com/confidentialite',
      },
    });
    await createLead(w);
    const away = { ...link, key: 'ailleurs', redirectUrl: 'https://partner.example/offre' };
    const campaignId = await insertCampaign(w, { status: 'preparing', trackedLinks: [link, away] });
    await w.t.mutation(fn.prepareCampaignBatch, { campaignId, filter: {} });
    const tokens = await w.t.run((ctx) => ctx.db.query('campaignLinkTokens').collect());
    const onSite = tokens.find((t) => t.linkKey === 'oui')!;
    const offSite = tokens.find((t) => t.linkKey === 'ailleurs')!;

    const bare = await w.t.mutation(fn.handleTrackedLinkClick, { token: onSite.token });
    expect(bare.identify).toBe(false);
    expect((await get(w, onSite._id)).identifyHash).toBeUndefined();

    const elsewhere = await w.t.mutation(fn.handleTrackedLinkClick, {
      token: offSite.token,
      grantHash: 'hash',
    });
    expect(elsewhere.identify).toBe(false);
    expect((await get(w, offSite._id)).identifyHash).toBeUndefined();

    const granted = await w.t.mutation(fn.handleTrackedLinkClick, {
      token: onSite.token,
      grantHash: 'hash',
    });
    expect(granted.identify).toBe(true);
    expect(await get(w, onSite._id)).toMatchObject({
      identifyHash: 'hash',
      identifyUntil: NOW + LINK_GRANT_MS,
    });
  });
});
