import { beforeAll, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedEmployee, type SeededEmployee, type T } from './helpers';

/** Materialize the sends of a freshly created campaign (single prep batch). */
async function prepareCampaign(t: T, campaignId: Id<'campaigns'>) {
  await t.mutation(internal.features.crm.internal.prepareCampaignBatch, {
    campaignId,
    filter: {},
  });
}

const SECRET = 'test-webhook-secret';

beforeAll(() => {
  // resolveBrevo falls back to env when appConfig is empty: the API key makes
  // SMS available + email count as Brevo-backed; the secret guards the routes.
  process.env.BREVO_API_KEY = 'test-brevo-key';
  process.env.BREVO_WEBHOOK_SECRET = SECRET;
});

async function setup(): Promise<{ t: T; emp: SeededEmployee }> {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  return { t, emp };
}

/** Email campaign + one sent row correlated by brevoMessageId. */
async function seedEmailSend(
  t: T,
  emp: SeededEmployee,
  brevoMessageId: string,
): Promise<{ leadId: Id<'leads'>; sendId: Id<'campaignSends'> }> {
  const as = asIdentity(t, emp.identity);
  const leadId = await as.mutation(api.features.crm.mutations.createLead, {
    firstName: 'Mail',
    lastName: 'Lead',
    email: 'mail@example.com',
  });
  const campaignId = await as.mutation(api.features.crm.mutations.createCampaign, {
    name: 'Webhook email',
    channel: 'email',
    filter: {},
    subject: 'Test',
    htmlBody: '<p>x</p>',
  });
  await prepareCampaign(t, campaignId);
  const sendId = await t.run(async (ctx) => {
    const send = (await ctx.db.query('campaignSends').collect())[0];
    await ctx.db.patch(send._id, { brevoMessageId });
    return send._id;
  });
  return { leadId, sendId };
}

/** SMS campaign + one sent row for a lead with a phone (smsRecipient stamped). */
async function seedSmsSend(t: T, emp: SeededEmployee): Promise<{ leadId: Id<'leads'> }> {
  const as = asIdentity(t, emp.identity);
  const leadId = await as.mutation(api.features.crm.mutations.createLead, {
    firstName: 'Sms',
    lastName: 'Lead',
    email: 'sms@example.com',
    phone: '+33612345678',
  });
  // The STOP path only revokes consent the lead actually holds.
  const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken ?? '';
  await t.mutation(api.features.crm.mutations.updateConsentByToken, {
    token,
    channels: ['email', 'sms'],
  });
  const campaignId = await as.mutation(api.features.crm.mutations.createCampaign, {
    name: 'Webhook sms',
    channel: 'sms',
    filter: {},
    smsBody: 'Bonjour',
  });
  await prepareCampaign(t, campaignId);
  return { leadId };
}

describe('webhook authentication', () => {
  test('both routes reject a missing or wrong secret, in header and query alike', async () => {
    const { t } = await setup();
    for (const path of ['/webhooks/brevo/sms', '/webhooks/brevo/email']) {
      const noSecret = await t.fetch(path, { method: 'POST', body: '{}' });
      expect(noSecret.status).toBe(401);
      const wrongSecret = await t.fetch(`${path}?secret=wrong`, { method: 'POST', body: '{}' });
      expect(wrongSecret.status).toBe(401);
      const wrongHeader = await t.fetch(path, {
        method: 'POST',
        body: '{}',
        headers: { 'x-webhook-secret': 'wrong' },
      });
      expect(wrongHeader.status).toBe(401);
    }
  });

  test('both routes accept the account secret in the x-webhook-secret header', async () => {
    const { t } = await setup();
    for (const path of ['/webhooks/brevo/sms', '/webhooks/brevo/email']) {
      const res = await t.fetch(path, {
        method: 'POST',
        body: '{}',
        headers: { 'x-webhook-secret': SECRET },
      });
      expect(res.status).toBe(200);
    }
  });

  test('the SMS query path uses the dedicated per-message secret when set', async () => {
    process.env.BREVO_SMS_WEBHOOK_SECRET = 'dedicated-sms-secret';
    try {
      const { t } = await setup();
      // Dedicated secret works in the query string…
      const dedicated = await t.fetch('/webhooks/brevo/sms?secret=dedicated-sms-secret', {
        method: 'POST',
        body: '{}',
      });
      expect(dedicated.status).toBe(200);
      // …the account secret no longer does (blast radius contained)…
      const shared = await t.fetch(`/webhooks/brevo/sms?secret=${SECRET}`, {
        method: 'POST',
        body: '{}',
      });
      expect(shared.status).toBe(401);
      // …while the account secret still authenticates via the header.
      const header = await t.fetch('/webhooks/brevo/sms', {
        method: 'POST',
        body: '{}',
        headers: { 'x-webhook-secret': SECRET },
      });
      expect(header.status).toBe(200);
    } finally {
      delete process.env.BREVO_SMS_WEBHOOK_SECRET;
    }
  });
});

describe('email events', () => {
  test('records the event, deduplicates replays, keeps genuine repeats', async () => {
    const { t, emp } = await setup();
    await seedEmailSend(t, emp, 'msg-1');

    const post = (body: unknown) =>
      t.fetch(`/webhooks/brevo/email?secret=${SECRET}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

    const event = { event: 'delivered', 'message-id': 'msg-1', ts_epoch: 1_000_000 };
    expect((await post(event)).status).toBe(200);
    expect((await post(event)).status).toBe(200); // Brevo retry: same timestamp
    await post({ ...event, ts_epoch: 2_000_000 }); // genuine repeat: new timestamp

    const events = await t.run((ctx) => ctx.db.query('campaignEvents').collect());
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.eventAt).sort()).toEqual([1_000_000, 2_000_000]);
  });

  test('stamps openedAt on the send, first event only', async () => {
    const { t, emp } = await setup();
    const { sendId } = await seedEmailSend(t, emp, 'msg-2');

    const open = (ts: number) =>
      t.fetch(`/webhooks/brevo/email?secret=${SECRET}`, {
        method: 'POST',
        body: JSON.stringify({ event: 'opened', 'message-id': 'msg-2', ts_epoch: ts }),
      });
    await open(5_000);
    await open(9_000);

    const send = await t.run((ctx) => ctx.db.get(sendId));
    expect(send?.openedAt).toBe(5_000);
  });

  test('an unknown message id is acknowledged without writing', async () => {
    const { t } = await setup();
    const res = await t.fetch(`/webhooks/brevo/email?secret=${SECRET}`, {
      method: 'POST',
      body: JSON.stringify({ event: 'delivered', 'message-id': 'unknown', ts_epoch: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await t.run((ctx) => ctx.db.query('campaignEvents').collect())).toHaveLength(0);
  });
});

describe('SMS STOP', () => {
  test('revokes the SMS consent, keeps other channels, leaves a system note', async () => {
    const { t, emp } = await setup();
    const { leadId } = await seedSmsSend(t, emp);

    const res = await t.fetch(`/webhooks/brevo/sms?secret=${SECRET}`, {
      method: 'POST',
      body: JSON.stringify({
        msg_status: 'unsubscribed',
        messageId: 999999, // fresh inbound id: correlation falls back to the phone
        to: '+33612345678',
        ts_event: 1_700_000,
      }),
    });
    expect(res.status).toBe(200);

    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.marketingConsent).toEqual(['email']); // sms removed, email kept
    expect(lead?.consentSource).toBe('sms_stop');

    const notes = await t.run((ctx) => ctx.db.query('leadNotes').collect());
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toContain('STOP');
    expect(notes[0].createdBy).toBeUndefined(); // system note, no author
  });

  test('a replayed STOP is idempotent: consent and note are not duplicated', async () => {
    const { t, emp } = await setup();
    const { leadId } = await seedSmsSend(t, emp);

    const stop = () =>
      t.fetch(`/webhooks/brevo/sms?secret=${SECRET}`, {
        method: 'POST',
        body: JSON.stringify({
          msg_status: 'unsubscribed',
          to: '33612345678',
          ts_event: 1_800_000,
        }),
      });
    await stop();
    await stop();

    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.marketingConsent).toEqual(['email']);
    expect(await t.run((ctx) => ctx.db.query('leadNotes').collect())).toHaveLength(1);
    // The replay (same eventAt) was deduplicated in the event log too.
    const events = await t.run((ctx) => ctx.db.query('campaignEvents').collect());
    expect(events.filter((e) => e.type === 'unsubscribed')).toHaveLength(1);
  });
});
