import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  NOTIFICATION_DELIVERY_BACKOFF_MS,
  NOTIFICATION_DELIVERY_HOLD_MS,
  NOTIFICATION_DELIVERY_TIMEOUT_MS,
} from '../../convex/_lib/validators/notifications';
import { setExtensionsForTests } from '../../convex/extensions';
import { defaultExtensions, SCHEDULED_WORK_RETRY_MS } from '../../convex/lib/extensions/types';
import { emailChannel } from '../../convex/lib/notifications/channels/email';
import { expireDelivery, queueDeliveries } from '../../convex/lib/notifications/deliveries';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  pinDice,
  runAfter,
  runDue,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 10, 4, 9, 0, 0);
const MINUTE = 60_000;
const ENV = ['BREVO_API_KEY', 'DEV_WHITELIST_EMAILS'] as const;
// Running the scheduled work lands the fake clock on the real time: the sessions must outlive that.
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Addresses no other test file uses. */
const CAMILLE = 'camille.deliveries@example.com';
const LOU = 'lou.deliveries@example.com';

type Mail = { to: { email: string }[]; subject: string; htmlContent: string };

let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
/** The provider's side: every mail it was asked to send, and the statuses it answers, in order (201 once none is left). */
let mails: Mail[] = [];
let statuses: number[] = [];

beforeEach(() => {
  pinClock(NOW);
  // The delays this file advances to are exact: no share of chance on top.
  pinDice(0);
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  const mine: Mail[] = [];
  const queue: number[] = [];
  mails = mine;
  statuses = queue;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    // Another file's background work is not ours: only a mail to our people is answered.
    const ours =
      String(input).includes('brevo.com') && (body.includes(CAMILLE) || body.includes(LOU));
    if (!ours) return new Response(null, { status: 503 });
    mine.push(JSON.parse(body));
    const status = queue.shift() ?? 201;
    return new Response(JSON.stringify(status === 201 ? { messageId: 'm1' } : { message: 'no' }), {
      status,
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setExtensionsForTests(defaultExtensions);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Lou (admin) acts; Camille (member) is told. Both have the e-mail channel within reach. */
async function setup() {
  const t = createTestConvex();
  const lou = await seedEmployee(t, {
    email: LOU,
    role: 'admin',
    firstName: 'Lou',
    lastName: 'Martin',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const camille = await seedEmployee(t, {
    email: CAMILLE,
    role: 'member',
    firstName: 'Camille',
    lastName: 'Roux',
    sessionTtlMs: SESSION_TTL_MS,
  });
  await seedConfig(t, {
    organizationName: 'Clinique Nord',
    appUrl: 'https://crm.example.com/',
    email: { provider: 'brevo', brevoApiKey: 'xkeysib-test' },
  });
  const asLou = asIdentity(t, lou.identity);
  const asCamille = asIdentity(t, camille.identity);
  return { t, lou, camille, asLou, asCamille };
}

type Session = ReturnType<typeof asIdentity>;
const choose = (
  as: Session,
  choice: { kinds?: Record<string, boolean>; channels?: Record<string, { enabled: boolean }> },
) => as.mutation(api.features.notifications.mutations.updateMyNotificationPreferences, choice);
const emailOn = (as: Session) => choose(as, { channels: { email: { enabled: true } } });
const inboxOf = (t: T, userId: Id<'users'>) =>
  t.run((ctx) =>
    ctx.db
      .query('notifications')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .collect(),
  );
const deliveries = (t: T) => t.run((ctx) => ctx.db.query('notificationDeliveries').collect());

/** Lou creates a lead and gives it to Camille; the fan-out has run, the deliveries still wait. */
async function assignLead(
  ctx: Awaited<ReturnType<typeof setup>>,
  name: { firstName: string; lastName: string } = { firstName: 'Jean', lastName: 'Dupont' },
) {
  const leadId = await ctx.asLou.mutation(api.features.leads.mutations.createLead, {
    ...name,
    ownerIds: [ctx.lou.userId],
  });
  await ctx.asLou.mutation(api.features.leads.mutations.updateLead, {
    leadId,
    ownerIds: [ctx.lou.userId, ctx.camille.userId],
  });
  await runDue(ctx.t);
  return leadId;
}

/** Lou creates a deal Camille owns, then moves it: the stage changes Camille is told about. */
async function dealOfCamille(ctx: Awaited<ReturnType<typeof setup>>) {
  const pipelineId = await ctx.asLou.mutation(
    api.features.deals.mutations.ensureDefaultPipeline,
    {},
  );
  const dealId = await ctx.asLou.mutation(api.features.deals.mutations.createDeal, {
    title: 'Cabinet Sud',
    pipelineId,
    ownerIds: [ctx.camille.userId],
  });
  await runDue(ctx.t);
  const move = async (stageKey: string) => {
    await ctx.asLou.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey });
    await runDue(ctx.t);
  };
  return { dealId, move };
}

describe('what a person’s preferences change in the fan-out', () => {
  test('Camille turns stage changes off and e-mail on: no stage change reaches her, a lead assigned to her arrives as a mail whose button opens it; Lou, who touched nothing, gets everything in the app and no mail', async () => {
    const ctx = await setup();
    const { t, lou, camille, asLou, asCamille } = ctx;
    await choose(asCamille, {
      kinds: { 'deal.stage_changed': false },
      channels: { email: { enabled: true } },
    });

    const { move } = await dealOfCamille(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    const mailsBefore = mails.length;
    await move('qualified');
    expect((await inboxOf(t, camille.userId)).map((row) => row.kind)).toEqual(['deal.assigned']);

    const leadId = await assignLead(ctx);
    const assigned = (await inboxOf(t, camille.userId)).find((row) => row.kind === 'lead.assigned');
    expect(assigned).toBeDefined();
    const waiting = (await deliveries(t)).filter((d) => d.notificationId === assigned!._id);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ channel: 'email', status: 'pending', attempts: 0 });
    expect(mails).toHaveLength(mailsBefore);

    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    const mail = mails.at(-1)!;
    expect(mails).toHaveLength(mailsBefore + 1);
    expect(mail.to).toEqual([{ email: CAMILLE }]);
    expect(mail.subject).toBe('[Clinique Nord] Lead attribué : Jean Dupont');
    expect(mail.htmlContent).toContain('Lou Martin vous a attribué le lead Jean Dupont.');
    expect(mail.htmlContent).toContain(`href="https://crm.example.com/leads/${leadId}"`);
    expect(mail.htmlContent).toContain('href="https://crm.example.com/settings/notifications"');
    expect((await deliveries(t)).find((d) => d._id === waiting[0]!._id)).toMatchObject({
      status: 'sent',
      attempts: 1,
    });

    // Lou is told in the app of what others do, and never by mail.
    const leadOfLou = await asCamille.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Anne',
      lastName: 'Petit',
      ownerIds: [camille.userId, lou.userId],
    });
    await runDue(t);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect((await inboxOf(t, lou.userId)).map((row) => row.path)).toEqual([`/leads/${leadOfLou}`]);
    expect(mails.every((sent) => sent.to[0]!.email === CAMILLE)).toBe(true);
    expect(await asLou.query(api.features.notifications.queries.unreadCount, {})).toBe(1);
  });

  test('the words of a record are escaped in the mail', async () => {
    const ctx = await setup();
    await emailOn(ctx.asCamille);
    await assignLead(ctx, { firstName: '<b>Max</b>', lastName: 'O’Neil & fils' });
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe('[Clinique Nord] Lead attribué : <b>Max</b> O’Neil & fils');
    expect(mails[0]!.htmlContent).toContain('&lt;b&gt;Max&lt;/b&gt; O’Neil &amp; fils');
    expect(mails[0]!.htmlContent).not.toContain('<b>Max</b>');
  });

  test('a record that changes again while its mail still waits adds none, and the mail says where it is now; a change after the mail left sends another', async () => {
    const ctx = await setup();
    const { t, camille, asCamille } = ctx;
    await emailOn(asCamille);
    const { move } = await dealOfCamille(ctx);
    // The assignment's own mail leaves first.
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(mails).toHaveLength(1);

    await move('qualified');
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS / 2);
    await move('proposal');
    const stage = (await inboxOf(t, camille.userId)).filter(
      (row) => row.kind === 'deal.stage_changed',
    );
    expect(stage).toHaveLength(1);
    expect((await deliveries(t)).filter((d) => d.notificationId === stage[0]!._id)).toHaveLength(1);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(mails).toHaveLength(2);
    expect(mails[1]!.htmlContent).toContain('Proposition envoyée');
    expect(mails[1]!.htmlContent).not.toContain('Qualifiée');

    await move('negotiation');
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(mails).toHaveLength(3);
    expect(
      (await deliveries(t)).filter((d) => d.notificationId === stage[0]!._id).map((d) => d.status),
    ).toEqual(['sent', 'sent']);
  });
});

describe('a delivery', () => {
  test('that fails is tried again after 1, 5, 15 and 60 minutes, then given up', async () => {
    const ctx = await setup();
    const { t, asCamille } = ctx;
    await emailOn(asCamille);
    statuses.push(500, 500, 500, 500, 500);
    await assignLead(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(mails).toHaveLength(1);
    expect((await deliveries(t))[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      error: 'email_send_failed',
    });

    expect(NOTIFICATION_DELIVERY_BACKOFF_MS).toEqual([
      MINUTE,
      5 * MINUTE,
      15 * MINUTE,
      60 * MINUTE,
    ]);
    for (const [index, wait] of NOTIFICATION_DELIVERY_BACKOFF_MS.entries()) {
      // Not a moment before its time.
      await runAfter(t, wait - 1000);
      expect(mails).toHaveLength(index + 1);
      await runAfter(t, 1000);
      expect(mails).toHaveLength(index + 2);
    }
    expect((await deliveries(t))[0]).toMatchObject({
      status: 'failed',
      attempts: 5,
      error: 'email_send_failed',
    });
    await runAfter(t, 24 * 60 * MINUTE);
    expect(mails).toHaveLength(5);
  });

  test('that fails once and then passes is sent, its error cleared', async () => {
    const ctx = await setup();
    await emailOn(ctx.asCamille);
    statuses.push(500);
    await assignLead(ctx);
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    await runAfter(ctx.t, MINUTE);
    expect(mails).toHaveLength(2);
    const [delivery] = await deliveries(ctx.t);
    expect(delivery).toMatchObject({ status: 'sent', attempts: 2 });
    expect(delivery!.error).toBeUndefined();
  });

  const skippedWhen = async (
    reason: string,
    change: (ctx: Awaited<ReturnType<typeof setup>>, leadId: Id<'leads'>) => Promise<void>,
  ) => {
    const ctx = await setup();
    await emailOn(ctx.asCamille);
    const leadId = await assignLead(ctx);
    await change(ctx, leadId);
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(mails).toEqual([]);
    expect((await deliveries(ctx.t))[0]).toMatchObject({
      status: 'skipped',
      attempts: 0,
      error: reason,
    });
    // Skipped at once: nothing is tried again.
    await runAfter(ctx.t, 2 * 60 * MINUTE);
    expect(mails).toEqual([]);
  };

  test('is skipped when the person turned the channel off while it waited', async () => {
    await skippedWhen('channel_disabled', async ({ asCamille }) => {
      await choose(asCamille, { channels: { email: { enabled: false } } });
    });
  });

  test('is skipped when the person read the notification in the app while it waited', async () => {
    await skippedWhen('read', async ({ t, camille, asCamille }) => {
      const [row] = await inboxOf(t, camille.userId);
      await asCamille.mutation(api.features.notifications.mutations.markRead, {
        notificationId: row!._id,
      });
    });
  });

  test('is skipped when the person turned its kind off while it waited', async () => {
    await skippedWhen('kind_disabled', async ({ asCamille }) => {
      await choose(asCamille, { kinds: { 'lead.assigned': false } });
    });
  });

  test('is skipped when the person lost the record while it waited: its name does not leave the app', async () => {
    await skippedWhen('access_lost', async ({ lou, asLou, asCamille }, leadId) => {
      await asLou.mutation(api.features.leads.mutations.updateLead, {
        leadId,
        ownerIds: [lou.userId],
      });
      expect(await asCamille.query(api.features.leads.queries.getLead, { leadId })).toBeNull();
    });
  });

  test('asks again at each retry: a record lost between two attempts ends the delivery', async () => {
    const ctx = await setup();
    const { t, lou, asLou, asCamille } = ctx;
    await emailOn(asCamille);
    statuses.push(500);
    const leadId = await assignLead(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(mails).toHaveLength(1);
    await asLou.mutation(api.features.leads.mutations.updateLead, {
      leadId,
      ownerIds: [lou.userId],
    });
    await runAfter(t, MINUTE);
    expect(mails).toHaveLength(1);
    expect((await deliveries(t))[0]).toMatchObject({
      status: 'skipped',
      attempts: 1,
      error: 'access_lost',
    });
  });

  test('still pending past its time is the one a refreshed notification rides: no second delivery, one mail', async () => {
    const ctx = await setup();
    const { t, camille, asCamille } = ctx;
    await emailOn(asCamille);
    await assignLead(ctx);
    const [first] = await deliveries(t);
    const requeue = () =>
      t.run(async (run) => {
        const preferences = await run.db
          .query('notificationPreferences')
          .withIndex('by_user', (q) => q.eq('userId', camille.userId))
          .first();
        await queueDeliveries(run, [emailChannel], preferences, first!.notificationId);
      });
    // The scheduler is late: the deadline has passed, the action has not started.
    await t.run((run) => run.db.patch(first!._id, { nextAt: Date.now() - MINUTE }));
    await requeue();
    expect(await deliveries(t)).toHaveLength(1);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(mails).toHaveLength(1);
    expect((await deliveries(t)).map((d) => d.status)).toEqual(['sent']);
  });

  test('already sending has read its text: a notification refreshed then gets a delivery of its own', async () => {
    const ctx = await setup();
    const { t, camille, asCamille } = ctx;
    await emailOn(asCamille);
    await assignLead(ctx);
    const [first] = await deliveries(t);
    const begin = () =>
      t.mutation(internal.features.notifications.internal.beginNotificationDelivery, {
        deliveryId: first!._id,
      });
    expect(await begin()).toMatchObject({ to: CAMILLE });
    expect((await deliveries(t))[0]).toMatchObject({ status: 'sending', attempts: 0 });
    // Begun once: a second start of the same delivery sends nothing.
    expect(await begin()).toBeNull();
    await t.run(async (run) => {
      const preferences = await run.db
        .query('notificationPreferences')
        .withIndex('by_user', (q) => q.eq('userId', camille.userId))
        .first();
      await queueDeliveries(run, [emailChannel], preferences, first!.notificationId);
    });
    expect((await deliveries(t)).map((d) => d.status)).toEqual(['sending', 'pending']);
  });

  test('whose send was interrupted does not stay sending: it is ended after the time an action can live, and not tried again', async () => {
    const ctx = await setup();
    const { t, asCamille } = ctx;
    await emailOn(asCamille);
    await assignLead(ctx);
    const [first] = await deliveries(t);
    // The action began and never recorded its result.
    await t.mutation(internal.features.notifications.internal.beginNotificationDelivery, {
      deliveryId: first!._id,
    });
    await t.run(async (run) => {
      const jobs = await run.db.system.query('_scheduled_functions').collect();
      for (const job of jobs) {
        if (job.name.endsWith(':deliverEmail')) await run.scheduler.cancel(job._id);
      }
    });
    // An attempt that is not the one sending leaves it alone.
    await t.run((run) => expireDelivery(run, first!._id, 3, 0));
    expect((await deliveries(t))[0]).toMatchObject({ status: 'sending', attempts: 0 });

    await runAfter(t, NOTIFICATION_DELIVERY_TIMEOUT_MS - 1000);
    expect((await deliveries(t))[0]).toMatchObject({ status: 'sending' });
    await runAfter(t, 1000);
    expect((await deliveries(t))[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'interrupted',
    });
    await runAfter(t, 2 * 60 * MINUTE);
    expect(mails).toEqual([]);
  });

  test('that was sent is left alone when the time an action can live has passed', async () => {
    const ctx = await setup();
    await emailOn(ctx.asCamille);
    await assignLead(ctx);
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_TIMEOUT_MS);
    const [delivery] = await deliveries(ctx.t);
    expect(delivery).toMatchObject({ status: 'sent', attempts: 1 });
    expect(delivery!.error).toBeUndefined();
  });

  test('is skipped when the deployment no longer has an e-mail provider', async () => {
    await skippedWhen('channel_not_available', async ({ t }) => {
      const config = await t.run((ctx) => ctx.db.query('appConfig').first());
      await t.run((ctx) => ctx.db.patch(config!._id, { email: undefined }));
    });
  });

  test('is skipped when the person is gone', async () => {
    await skippedWhen('recipient_gone', async ({ t, camille }) => {
      await t.run((ctx) => ctx.db.patch(camille.userId, { deletedAt: Date.now() }));
    });
  });

  test('is skipped when its notification was purged', async () => {
    await skippedWhen('notification_gone', async ({ t, camille }) => {
      const rows = await inboxOf(t, camille.userId);
      await t.run(async (ctx) => {
        for (const row of rows) await ctx.db.delete(row._id);
      });
    });
  });

  test('is skipped in dev for an address the whitelist does not hold', async () => {
    await skippedWhen('dev_whitelist', async () => {
      process.env.DEV_WHITELIST_EMAILS = 'someone.else@example.com';
    });
  });

  test('deferred by the extension seam waits a retry away without counting an attempt, then leaves', async () => {
    const ctx = await setup();
    const { t, asCamille } = ctx;
    await emailOn(asCamille);
    await assignLead(ctx);
    const asked: string[] = [];
    setExtensionsForTests({
      beforeScheduledWork: async (_ctx, { kind }) => {
        asked.push(kind);
        return kind !== 'notification_delivery';
      },
    });
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(asked).toContain('notification_delivery');
    expect(mails).toEqual([]);
    const [deferred] = await deliveries(t);
    expect(deferred).toMatchObject({ status: 'pending', attempts: 0 });
    expect(deferred!.nextAt).toBeGreaterThan(Date.now() + SCHEDULED_WORK_RETRY_MS - 1000);

    setExtensionsForTests(defaultExtensions);
    await runAfter(t, SCHEDULED_WORK_RETRY_MS);
    expect(mails).toHaveLength(1);
    expect((await deliveries(t))[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });
});
