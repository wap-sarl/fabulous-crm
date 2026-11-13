import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import {
  NOTIFICATION_DELIVERY_HOLD_MS,
  NOTIFICATION_DELIVERY_JITTER,
  NOTIFICATION_DELIVERY_MAX_WAITS,
  NOTIFICATION_DELIVERY_WAIT_MAX_MS,
  NOTIFICATION_DELIVERY_WAIT_MIN_MS,
} from '../../convex/_lib/validators/notifications';
import {
  asIdentity,
  createTestConvex,
  loadedDice,
  pinClock,
  pinDice,
  runAfter,
  runDue,
  seedConfig,
  seedEmployee,
  type T,
  unpinDice,
} from './helpers';

// What a webhook does to a burst: Discord takes five requests per two seconds, Slack one per second, and both say when to come back.

const NOW = Date.UTC(2026, 10, 13, 9, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOLD = NOTIFICATION_DELIVERY_HOLD_MS;
const SESSION_TTL_MS = 365 * 24 * 60 * MINUTE;
const ENV = ['BREVO_API_KEY', 'SECRETS_KEY', 'SECRETS_KEY_NEXT'] as const;
const DISCORD = 'https://discord.com/api/webhooks/1239000000000000001/camille-Burst_Token';
const SLACK = 'https://hooks.slack.com/services/T0BURSTTEST/B0CAMILLE/camilleSecret';

let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
/** Every request each service saw, by the fake clock. */
let posts: { url: string; at: number }[] = [];
/** The service's rule for the next answers, in order; empty means the rate limit decides. */
let answers: Response[] = [];
/** The limit each service applies: so many requests per window, else 429 saying when. */
let limits = { discord: { per: 5, windowMs: 2 * SECOND }, slack: { per: 1, windowMs: SECOND } };

beforeEach(() => {
  pinClock(NOW);
  // The delays this file advances to are exact: no share of chance on top.
  pinDice(0);
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.SECRETS_KEY = 'a'.repeat(64);
  const seen: { url: string; at: number }[] = [];
  const queue: Response[] = [];
  posts = seen;
  answers = queue;
  limits = { discord: { per: 5, windowMs: 2 * SECOND }, slack: { per: 1, windowMs: SECOND } };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const service = url.includes('1239000000000000001')
      ? 'discord'
      : url.includes('T0BURSTTEST')
        ? 'slack'
        : null;
    if (!service) return new Response(null, { status: 503 });
    const at = Date.now();
    seen.push({ url, at });
    const scripted = queue.shift();
    if (scripted) return scripted;
    const { per, windowMs } = limits[service];
    const inWindow = seen.filter((p) => p.url === url && p.at > at - windowMs).length;
    if (inWindow <= per) return new Response(null, { status: 204 });
    const seconds = windowMs / SECOND;
    return service === 'discord'
      ? Response.json(
          { message: 'You are being rate limited.', retry_after: seconds },
          { status: 429 },
        )
      : new Response('', { status: 429, headers: { 'retry-after': String(seconds) } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function setup() {
  const t = createTestConvex();
  const lou = await seedEmployee(t, {
    email: 'lou.burst@example.com',
    role: 'admin',
    firstName: 'Lou',
    lastName: 'Martin',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const camille = await seedEmployee(t, {
    email: 'camille.burst@example.com',
    role: 'member',
    firstName: 'Camille',
    lastName: 'Roux',
    sessionTtlMs: SESSION_TTL_MS,
  });
  await seedConfig(t, { appUrl: 'https://crm.example.com', plugins: ['discord', 'slack'] });
  const asLou = asIdentity(t, lou.identity);
  const asCamille = asIdentity(t, camille.identity);
  return { t, lou, camille, asLou, asCamille };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const choose = (ctx: Ctx, channel: 'discord' | 'slack', target: string) =>
  ctx.asCamille.mutation(api.features.notifications.mutations.updateMyNotificationPreferences, {
    channels: { [channel]: { enabled: true, target } },
  });

/** Lou creates `count` leads and hands each to Camille: one notification and one delivery each, all queued in the same second. */
async function burst(ctx: Ctx, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const leadId = await ctx.asLou.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Lead',
      lastName: String(i + 1).padStart(2, '0'),
      ownerIds: [ctx.lou.userId],
    });
    await ctx.asLou.mutation(api.features.leads.mutations.updateLead, {
      leadId,
      ownerIds: [ctx.lou.userId, ctx.camille.userId],
    });
  }
  await runDue(ctx.t);
}

const deliveries = (t: T) => t.run((ctx) => ctx.db.query('notificationDeliveries').collect());
/** The fake clock moves a few milliseconds while scheduled work runs: an instant is checked to within that. */
const expectAbout = (actual: number, expected: number) =>
  expect(actual).toBeWithin(expected - 5, expected + 6);
const statuses = async (t: T) => {
  const rows = await deliveries(t);
  const count = (status: string) => rows.filter((row) => row.status === status).length;
  return { sent: count('sent'), pending: count('pending'), failed: count('failed') };
};

describe('a burst against a rate-limited webhook', () => {
  test('thirty leads handed to Camille all reach her Discord channel: a 429 that says when is waited out, no attempt is counted, nothing fails', async () => {
    const ctx = await setup();
    await choose(ctx, 'discord', DISCORD);
    await burst(ctx, 30);
    await runAfter(ctx.t, HOLD);
    // The hold ends for all thirty at once: five pass, the rest are told to come back in two seconds.
    expect(statuses(ctx.t)).resolves.toEqual({ sent: 5, pending: 25, failed: 0 });
    const waiting = (await deliveries(ctx.t)).filter((row) => row.status === 'pending');
    expect(new Set(waiting.map((row) => row.error))).toEqual(new Set(['rate_limited']));
    for (const row of waiting) expectAbout(row.nextAt, Date.now() + 2 * SECOND);
    expect(waiting.every((row) => row.attempts === 0 && row.waits === 1)).toBe(true);
    // Every two seconds, five more.
    for (let round = 1; round <= 5; round++) {
      await runAfter(ctx.t, 2 * SECOND);
      expect((await statuses(ctx.t)).sent).toBe(5 + 5 * round);
    }
    const rows = await deliveries(ctx.t);
    expect(rows.every((row) => row.status === 'sent' && row.attempts === 1)).toBe(true);
    expect(Math.max(...rows.map((row) => row.waits ?? 0))).toBe(5);
    expect(rows.every((row) => row.error === undefined)).toBe(true);
    // Twelve seconds in all, not an hour of backoff; the service saw the burst and the five rounds.
    expect(posts).toHaveLength(30 + 25 + 20 + 15 + 10 + 5);
  });

  test('Slack says it in a header, one per second', async () => {
    const ctx = await setup();
    await choose(ctx, 'slack', SLACK);
    await burst(ctx, 3);
    await runAfter(ctx.t, HOLD);
    expect(await statuses(ctx.t)).toEqual({ sent: 1, pending: 2, failed: 0 });
    await runAfter(ctx.t, SECOND);
    expect(await statuses(ctx.t)).toEqual({ sent: 2, pending: 1, failed: 0 });
    await runAfter(ctx.t, SECOND);
    expect(await statuses(ctx.t)).toEqual({ sent: 3, pending: 0, failed: 0 });
    expect((await deliveries(ctx.t)).map((row) => row.attempts)).toEqual([1, 1, 1]);
  });

  test('thirty against Slack’s one per second: the asked wait takes a share of chance, so the refused do not come back as one, and all pass within the waits allowed', async () => {
    const ctx = await setup();
    await choose(ctx, 'slack', SLACK);
    await burst(ctx, 30);
    pinDice(loadedDice(7));
    await runAfter(ctx.t, HOLD);
    expect(await statuses(ctx.t)).toEqual({ sent: 1, pending: 29, failed: 0 });
    const asked = (await deliveries(ctx.t)).filter((row) => row.status === 'pending');
    // One second asked, up to five of chance on top: not two alike in thirty.
    const comebacks = new Set(asked.map((row) => row.nextAt));
    expect(comebacks.size).toBeGreaterThan(20);
    for (const row of asked) expect(row.nextAt - Date.now()).toBeWithin(SECOND, 6 * SECOND + 1);
    for (let second = 0; second < 120; second++) await runAfter(ctx.t, SECOND);
    const rows = await deliveries(ctx.t);
    expect(rows.every((row) => row.status === 'sent' && row.attempts === 1)).toBe(true);
    expect(Math.max(...rows.map((row) => row.waits ?? 0))).toBeLessThanOrEqual(
      NOTIFICATION_DELIVERY_MAX_WAITS,
    );
  });

  test('a check left by an earlier send does not end a later one: waited once, sent again, the first expiry finds the same attempt but not the same waits', async () => {
    const ctx = await setup();
    await choose(ctx, 'discord', DISCORD);
    await burst(ctx, 1);
    answers.push(Response.json({ retry_after: 2 }, { status: 429 }));
    await runAfter(ctx.t, HOLD);
    const [row] = await deliveries(ctx.t);
    expect(row).toMatchObject({ status: 'pending', attempts: 0, waits: 1 });
    // The second send is in progress when the first send's check fires, as it was scheduled: attempt 0, no wait yet.
    const stub = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      globalThis.fetch = stub;
      await ctx.t.mutation(internal.features.notifications.internal.expireNotificationDelivery, {
        deliveryId: row!._id,
        attempts: 0,
        waits: 0,
      });
      expect((await deliveries(ctx.t))[0]).toMatchObject({ status: 'sending' });
      return await stub(input, init);
    }) as typeof fetch;
    await runAfter(ctx.t, 2 * SECOND);
    expect((await deliveries(ctx.t))[0]).toMatchObject({ status: 'sent', attempts: 1, waits: 1 });
    // The check of the second send, in its turn, finds a row that is no longer sending.
    await runAfter(ctx.t, 15 * MINUTE);
    expect((await deliveries(ctx.t))[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  test('a wait is honoured within bounds: a second at least, five minutes at most; a 429 that says nothing usable is a failed attempt on the backoff', async () => {
    const ctx = await setup();
    await choose(ctx, 'discord', DISCORD);
    await burst(ctx, 1);
    answers.push(Response.json({ retry_after: 3600 }, { status: 429 }));
    await runAfter(ctx.t, HOLD);
    let [row] = await deliveries(ctx.t);
    expect(row).toMatchObject({ status: 'pending', attempts: 0, waits: 1, error: 'rate_limited' });
    expectAbout(row!.nextAt, Date.now() + NOTIFICATION_DELIVERY_WAIT_MAX_MS);

    answers.push(Response.json({ retry_after: 0.05 }, { status: 429 }));
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_WAIT_MAX_MS);
    [row] = await deliveries(ctx.t);
    expect(row).toMatchObject({ status: 'pending', attempts: 0, waits: 2 });
    expectAbout(row!.nextAt, Date.now() + NOTIFICATION_DELIVERY_WAIT_MIN_MS);

    // A date in the header is read too, to the second it names.
    const until = Date.now() + 5 * SECOND;
    answers.push(
      new Response('', { status: 429, headers: { 'retry-after': new Date(until).toUTCString() } }),
    );
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_WAIT_MIN_MS);
    [row] = await deliveries(ctx.t);
    expect(row).toMatchObject({ status: 'pending', attempts: 0, waits: 3 });
    expect(row!.nextAt).toBe(Math.floor(until / SECOND) * SECOND);

    // Zero means now: a wait all the same, of a second.
    answers.push(new Response('', { status: 429, headers: { 'retry-after': '0' } }));
    await runAfter(ctx.t, 5 * SECOND);
    [row] = await deliveries(ctx.t);
    expect(row).toMatchObject({ status: 'pending', attempts: 0, waits: 4 });
    expectAbout(row!.nextAt, Date.now() + NOTIFICATION_DELIVERY_WAIT_MIN_MS);

    // Nothing usable: the backoff, and an attempt.
    answers.push(new Response('', { status: 429 }));
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_WAIT_MIN_MS);
    [row] = await deliveries(ctx.t);
    expect(row).toMatchObject({ status: 'pending', attempts: 1, waits: 4, error: 'send_failed' });
    expectAbout(row!.nextAt, Date.now() + MINUTE);
    await runAfter(ctx.t, MINUTE);
    expect((await deliveries(ctx.t))[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  test('a service that always says « later » cannot park a delivery: past ten waits, each one is a failed attempt, and the delivery ends', async () => {
    const ctx = await setup();
    await choose(ctx, 'discord', DISCORD);
    await burst(ctx, 1);
    limits.discord = { per: 0, windowMs: 2 * SECOND };
    await runAfter(ctx.t, HOLD);
    for (let wait = 1; wait < NOTIFICATION_DELIVERY_MAX_WAITS; wait++) {
      expect((await deliveries(ctx.t))[0]).toMatchObject({ attempts: 0, waits: wait });
      await runAfter(ctx.t, 2 * SECOND);
    }
    expect((await deliveries(ctx.t))[0]).toMatchObject({
      status: 'pending',
      attempts: 0,
      waits: NOTIFICATION_DELIVERY_MAX_WAITS,
    });
    await runAfter(ctx.t, 2 * SECOND);
    expect((await deliveries(ctx.t))[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      error: 'rate_limited',
    });
    expectAbout((await deliveries(ctx.t))[0]!.nextAt, Date.now() + MINUTE);
    await runAfter(ctx.t, MINUTE);
    await runAfter(ctx.t, 5 * MINUTE);
    await runAfter(ctx.t, 15 * MINUTE);
    await runAfter(ctx.t, 60 * MINUTE);
    expect((await deliveries(ctx.t))[0]).toMatchObject({
      status: 'failed',
      attempts: 5,
      waits: NOTIFICATION_DELIVERY_MAX_WAITS,
      error: 'rate_limited',
    });
    expect(posts).toHaveLength(1 + NOTIFICATION_DELIVERY_MAX_WAITS + 4);
  });

  test('the hold and each step of the backoff take up to a fifth of chance on top, so a burst spreads', async () => {
    const ctx = await setup();
    await choose(ctx, 'discord', DISCORD);
    unpinDice();
    await burst(ctx, 12);
    const queued = await deliveries(ctx.t);
    const holds = queued.map((row) => row.nextAt - row.createdAt);
    expect(
      holds.every((hold) => hold >= HOLD && hold <= HOLD * (1 + NOTIFICATION_DELIVERY_JITTER)),
    ).toBe(true);
    expect(new Set(holds).size).toBeGreaterThan(1);
    // Let them all through, so that nothing is left due when the test ends.
    limits.discord = { per: 100, windowMs: SECOND };
    await runAfter(ctx.t, HOLD * (1 + NOTIFICATION_DELIVERY_JITTER));
    expect((await statuses(ctx.t)).sent).toBe(12);

    // The dice at their highest: the longest hold, then the longest first step.
    pinDice(0.999);
    const late = await setup();
    await choose(late, 'discord', DISCORD);
    await burst(late, 1);
    const [row] = await deliveries(late.t);
    expect(row!.nextAt - row!.createdAt).toBe(
      HOLD + Math.floor(0.999 * HOLD * NOTIFICATION_DELIVERY_JITTER),
    );
    answers.push(new Response('', { status: 500 }));
    await runAfter(late.t, HOLD * (1 + NOTIFICATION_DELIVERY_JITTER));
    const [failed] = await deliveries(late.t);
    expect(failed).toMatchObject({ status: 'pending', attempts: 1 });
    expectAbout(
      failed!.nextAt,
      Date.now() + MINUTE + Math.floor(0.999 * MINUTE * NOTIFICATION_DELIVERY_JITTER),
    );
  });

  test('« tester » is not retried: a service asking to wait did not take the message, and the answer says so', async () => {
    const ctx = await setup();
    await choose(ctx, 'discord', DISCORD);
    answers.push(Response.json({ retry_after: 2 }, { status: 429 }));
    expect(
      await ctx.asCamille.action(api.features.notifications.actions.testNotificationChannel, {
        channel: 'discord',
      }),
    ).toBe('rate_limited');
  });
});
