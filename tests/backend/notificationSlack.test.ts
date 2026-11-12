import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { NOTIFICATION_DELIVERY_HOLD_MS } from '../../convex/_lib/validators/notifications';
import { slackMessage } from '../../convex/lib/notifications/channels/slack';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runAfter,
  runDue,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 10, 9, 9, 0, 0);
const MINUTE = 60_000;
const ENV = ['BREVO_API_KEY', 'SECRETS_KEY', 'SECRETS_KEY_NEXT'] as const;
// Running the scheduled work lands the fake clock on the real time: the sessions must outlive that.
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Webhooks no other test file uses. */
const HOOK = 'https://hooks.slack.com/services/T0SLACKTEST/B0CAMILLE/camilleSecret';
const HOOK_LOU = 'https://hooks.slack.com/services/T0SLACKTEST/B0LOU/louSecret';

let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
/** Slack's side: every message it was sent and where, and what it answers, in order (200 once none is left); `down` makes the call itself fail. */
let posts: { url: string; text: string }[] = [];
let statuses: (number | 'down')[] = [];

beforeEach(() => {
  pinClock(NOW);
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.SECRETS_KEY = 'a'.repeat(64);
  const mine: { url: string; text: string }[] = [];
  const queue: (number | 'down')[] = [];
  posts = mine;
  statuses = queue;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    // Another file's background work is not ours: only our webhooks are answered.
    if (!url.includes('T0SLACKTEST')) return new Response(null, { status: 503 });
    mine.push({ url, text: JSON.parse(String(init?.body)).text });
    const status = queue.shift() ?? 200;
    if (status === 'down') throw new TypeError(`fetch failed: ${url}`);
    return new Response(status === 200 ? 'ok' : 'no_service', { status });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Lou (admin) acts and administers; Camille (member) is told. No e-mail provider: Slack is the only channel there can be. */
async function setup(plugins: string[] = ['slack']) {
  const t = createTestConvex();
  const lou = await seedEmployee(t, {
    email: 'lou.slack@example.com',
    role: 'admin',
    firstName: 'Lou',
    lastName: 'Martin',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const camille = await seedEmployee(t, {
    email: 'camille.slack@example.com',
    role: 'member',
    firstName: 'Camille',
    lastName: 'Roux',
    sessionTtlMs: SESSION_TTL_MS,
  });
  await seedConfig(t, {
    organizationName: 'Clinique Nord',
    appUrl: 'https://crm.example.com/',
    plugins,
  });
  const asLou = asIdentity(t, lou.identity);
  const asCamille = asIdentity(t, camille.identity);
  return { t, lou, camille, asLou, asCamille };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
type Session = ReturnType<typeof asIdentity>;
const read = (as: Session) =>
  as.query(api.features.notifications.queries.getMyNotificationPreferences, {});
const choose = (as: Session, slack: { enabled: boolean; target?: string | null }) =>
  as.mutation(api.features.notifications.mutations.updateMyNotificationPreferences, {
    channels: { slack },
  });
const storedOf = async (t: T, userId: Id<'users'>) =>
  (
    await t.run((ctx) =>
      ctx.db
        .query('notificationPreferences')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .first(),
    )
  )?.channels.slack;
const deliveries = (t: T) => t.run((ctx) => ctx.db.query('notificationDeliveries').collect());
const settingsOf = (as: Session, channel = 'slack') =>
  as.query(api.features.notifications.queries.getNotificationChannelSettings, { channel });
const setNames = (as: Session, names: 'full' | 'none', channel = 'slack') =>
  as.mutation(api.features.notifications.mutations.updateNotificationChannelSettings, {
    channel,
    names,
  });
const testChannel = (as: Session, channel = 'slack') =>
  as.action(api.features.notifications.actions.testNotificationChannel, { channel });
const install = (as: Session) =>
  as.mutation(api.features.plugins.mutations.installPlugin, { key: 'slack' });
const uninstall = (as: Session) =>
  as.mutation(api.features.plugins.mutations.uninstallPlugin, { key: 'slack' });
const pluginAudits = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .filter((q) => q.eq(q.field('entityType'), 'plugin'))
      .collect(),
  );

/** Lou creates a lead and gives it to Camille; the fan-out has run, the deliveries still wait. */
async function assignLead(
  ctx: Ctx,
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

describe('the Slack channel', () => {
  test('is there while the plugin is installed: uninstalled it is neither shown nor accepted, and a reinstall finds the person’s choice', async () => {
    const ctx = await setup([]);
    const { t, camille, asLou, asCamille } = ctx;
    expect((await read(asCamille)).channels).toEqual([]);
    await expect(choose(asCamille, { enabled: true, target: HOOK })).rejects.toMatchObject({
      data: { code: 'channel_not_available' },
    });

    await install(asLou);
    expect((await read(asCamille)).channels).toEqual([
      {
        key: 'slack',
        label: 'Slack',
        description: expect.stringContaining('webhook entrant'),
        enabled: false,
        target: {
          label: 'URL de votre webhook entrant',
          placeholder: 'https://hooks.slack.com/services/…',
          set: false,
        },
      },
    ]);
    await choose(asCamille, { enabled: true, target: HOOK });
    expect((await read(asCamille)).channels[0]).toMatchObject({
      enabled: true,
      target: { set: true, hint: 'hooks.slack.com · T0SLACKTEST' },
    });

    await uninstall(asLou);
    expect((await read(asCamille)).channels).toEqual([]);
    await expect(choose(asCamille, { enabled: false })).rejects.toMatchObject({
      data: { code: 'channel_not_available' },
    });
    // Nothing is told to Slack meanwhile, and no delivery is written for it.
    await assignLead(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(t)).toEqual([]);
    expect(posts).toEqual([]);

    await install(asLou);
    expect((await read(asCamille)).channels[0]).toMatchObject({
      enabled: true,
      target: { set: true, hint: 'hooks.slack.com · T0SLACKTEST' },
    });
    expect((await storedOf(t, camille.userId))?.enabled).toBe(true);
  });

  test('takes an incoming webhook of hooks.slack.com and nothing else, keeps it as ciphertext, and says only its host and its workspace', async () => {
    const { t, camille, asCamille } = await setup();
    for (const target of [
      'http://hooks.slack.com/services/T0SLACKTEST/B0CAMILLE/camilleSecret',
      'https://hooks.slack.com.example.com/services/T0SLACKTEST/B0CAMILLE/camilleSecret',
      'https://example.com/services/T0SLACKTEST/B0CAMILLE/camilleSecret',
      'https://hooks.slack.com/services/T0SLACKTEST/B0CAMILLE',
      'https://hooks.slack.com/services/T0SLACKTEST/B0CAMILLE/camilleSecret?next=https://example.com',
      'https://hooks.slack.com@example.com/services/T0SLACKTEST/B0CAMILLE/camilleSecret',
      '',
    ]) {
      await expect(choose(asCamille, { enabled: true, target })).rejects.toMatchObject({
        data: { code: 'invalid_channel_target' },
      });
    }
    await expect(choose(asCamille, { enabled: true })).rejects.toMatchObject({
      data: { code: 'invalid_channel_target' },
    });
    expect(await storedOf(t, camille.userId)).toBeUndefined();

    await choose(asCamille, { enabled: true, target: ` ${HOOK}\n` });
    const stored = await storedOf(t, camille.userId);
    expect(stored).toMatchObject({ enabled: true, hint: 'hooks.slack.com · T0SLACKTEST' });
    expect(stored!.hint).not.toContain('B0CAMILLE');
    expect(stored!.target).toMatch(/^v1:/);
    expect(JSON.stringify(stored)).not.toContain('camilleSecret');
    expect(JSON.stringify(await read(asCamille))).not.toContain('camilleSecret');
  });
});

describe('a notification delivered to Slack', () => {
  test('Camille pastes her webhook: the next lead assigned to her lands there with its name and a link that opens it; Lou, who gave none, gets nothing', async () => {
    const ctx = await setup();
    const { t, asCamille } = ctx;
    await choose(asCamille, { enabled: true, target: HOOK });
    const leadId = await assignLead(ctx);
    expect(posts).toEqual([]);
    expect(await deliveries(t)).toMatchObject([{ channel: 'slack', status: 'pending' }]);

    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(posts).toEqual([
      {
        url: HOOK,
        text: [
          '*Lead attribué : Jean Dupont*',
          'Lou Martin vous a attribué le lead Jean Dupont.',
          `<https://crm.example.com/leads/${leadId}|Ouvrir dans le CRM>`,
        ].join('\n'),
      },
    ]);
    expect(await deliveries(t)).toMatchObject([{ channel: 'slack', status: 'sent', attempts: 1 }]);
  });

  test('writes the words of a record as they are: nothing in a name is read as Slack markup', () => {
    expect(
      slackMessage({
        title: 'Lead attribué : <!channel> & <https://example.com|ici>',
        body: 'A > B',
        url: 'https://crm.example.com/leads/1',
      }).text,
    ).toBe(
      [
        '*Lead attribué : &lt;!channel&gt; &amp; &lt;https://example.com|ici&gt;*',
        'A &gt; B',
        '<https://crm.example.com/leads/1|Ouvrir dans le CRM>',
      ].join('\n'),
    );
  });

  test('that Slack refuses for good is skipped at once, and the person’s channel goes off saying when: a revoked webhook is written to once, not at every notification', async () => {
    const ctx = await setup();
    const { t, camille, asCamille } = ctx;
    await choose(asCamille, { enabled: true, target: HOOK });
    statuses.push(404);
    await assignLead(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(t)).toMatchObject([{ status: 'skipped', error: 'target_refused' }]);
    expect(posts).toHaveLength(1);

    const refused = await storedOf(t, camille.userId);
    expect(refused).toMatchObject({ enabled: false, hint: 'hooks.slack.com · T0SLACKTEST' });
    expect(refused!.refusedAt).toEqual(expect.any(Number));
    expect(refused!.target).toMatch(/^v1:/);
    expect((await read(asCamille)).channels[0]).toMatchObject({
      enabled: false,
      target: { set: true, refusedAt: refused!.refusedAt },
    });
    // The next notification writes no delivery and nothing reaches Slack.
    await assignLead(ctx, { firstName: 'Anne', lastName: 'Petit' });
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(t)).toHaveLength(1);
    expect(posts).toHaveLength(1);

    // A new webhook is a new choice: the refusal is forgotten, and messages leave again.
    await choose(asCamille, { enabled: true, target: HOOK.replace('camilleSecret', 'camilleNew') });
    const replaced = await storedOf(t, camille.userId);
    expect(replaced!.enabled).toBe(true);
    expect(replaced!.refusedAt).toBeUndefined();
    expect((await read(asCamille)).channels[0]!.target!.refusedAt).toBeUndefined();
    await assignLead(ctx, { firstName: 'Paul', lastName: 'Morel' });
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(posts.at(-1)!.url).toContain('camilleNew');
    // The refused delivery itself is never tried again.
    await runAfter(t, 2 * 60 * MINUTE);
    expect(posts).toHaveLength(2);
    expect((await deliveries(t)).map((d) => d.status)).toEqual(['skipped', 'sent']);
  });

  test('refused while the person was replacing their webhook leaves the new one on: the refusal was the old one’s', async () => {
    const ctx = await setup();
    const { t, camille, asCamille } = ctx;
    await choose(asCamille, { enabled: true, target: HOOK });
    const sending = globalThis.fetch;
    // Slack answers 404 for the old webhook, after the new one has been saved.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      globalThis.fetch = sending;
      await choose(asCamille, {
        enabled: true,
        target: HOOK.replace('camilleSecret', 'camilleNew'),
      });
      statuses.push(404);
      return await sending(input, init);
    }) as typeof fetch;
    await assignLead(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(t)).toMatchObject([{ status: 'skipped', error: 'target_refused' }]);
    expect(posts.map((post) => post.url)).toEqual([HOOK]);
    const kept = await storedOf(t, camille.userId);
    expect(kept).toMatchObject({ enabled: true });
    expect(kept!.refusedAt).toBeUndefined();
    expect((await read(asCamille)).channels[0]!.target!.refusedAt).toBeUndefined();
    await assignLead(ctx, { firstName: 'Anne', lastName: 'Petit' });
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(posts.at(-1)!.url).toContain('camilleNew');
    expect((await deliveries(t)).map((d) => d.status)).toEqual(['skipped', 'sent']);
  });

  test('refused once and turned on again by the person is tried again: the choice is theirs', async () => {
    const ctx = await setup();
    await choose(ctx.asCamille, { enabled: true, target: HOOK });
    statuses.push(410);
    await assignLead(ctx);
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect((await storedOf(ctx.t, ctx.camille.userId))!.enabled).toBe(false);
    await choose(ctx.asCamille, { enabled: true });
    expect((await storedOf(ctx.t, ctx.camille.userId))!.refusedAt).toBeUndefined();
    await assignLead(ctx, { firstName: 'Anne', lastName: 'Petit' });
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(posts).toHaveLength(2);
    expect((await deliveries(ctx.t)).at(-1)).toMatchObject({ status: 'sent' });
  });

  test('that Slack cannot take now is tried again, whether it answers 500, 429, 400 or not at all: the channel stays on, and no log line carries the webhook', async () => {
    const ctx = await setup();
    await choose(ctx.asCamille, { enabled: true, target: HOOK });
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    try {
      statuses.push(500, 429, 400, 'down');
      await assignLead(ctx);
      await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
      expect(await deliveries(ctx.t)).toMatchObject([
        { status: 'pending', attempts: 1, error: 'send_failed' },
      ]);
      await runAfter(ctx.t, MINUTE);
      await runAfter(ctx.t, 5 * MINUTE);
      await runAfter(ctx.t, 15 * MINUTE);
      expect(await deliveries(ctx.t)).toMatchObject([{ status: 'pending', attempts: 4 }]);
      await runAfter(ctx.t, 60 * MINUTE);
      expect(posts).toHaveLength(5);
      const [delivery] = await deliveries(ctx.t);
      expect(delivery).toMatchObject({ status: 'sent', attempts: 5 });
      expect(delivery!.error).toBeUndefined();
      expect(await storedOf(ctx.t, ctx.camille.userId)).toMatchObject({ enabled: true });
      expect(JSON.stringify(logged.mock.calls)).not.toContain('hooks.slack.com');
    } finally {
      logged.mockRestore();
    }
  });

  const unreadable: [string, (ctx: Ctx) => Promise<void>][] = [
    [
      'a damaged ciphertext',
      async ({ t, camille }) => {
        const row = await t.run((c) =>
          c.db
            .query('notificationPreferences')
            .withIndex('by_user', (q) => q.eq('userId', camille.userId))
            .first(),
        );
        await t.run((c) =>
          c.db.patch(row!._id, {
            channels: { slack: { ...row!.channels.slack!, target: 'v1:damaged' } },
          }),
        );
      },
    ],
    [
      'a key that changed',
      async () => {
        process.env.SECRETS_KEY = 'b'.repeat(64);
      },
    ],
    [
      'a key that is gone',
      async () => {
        delete process.env.SECRETS_KEY;
      },
    ],
  ];
  for (const [what, change] of unreadable) {
    test(`whose webhook can no longer be decrypted is skipped, not left pending: ${what}`, async () => {
      const ctx = await setup();
      await choose(ctx.asCamille, { enabled: true, target: HOOK });
      await assignLead(ctx);
      await change(ctx);
      await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
      expect(await deliveries(ctx.t)).toMatchObject([
        { status: 'skipped', attempts: 0, error: 'target_unreadable' },
      ]);
      // The test of the channel says the same, as a refusal the page words.
      await expect(testChannel(ctx.asCamille)).rejects.toMatchObject({
        data: { code: 'channel_target_unreadable' },
      });
      // Nothing is left scheduled for it.
      await runAfter(ctx.t, 2 * 60 * MINUTE);
      expect(await deliveries(ctx.t)).toMatchObject([{ status: 'skipped' }]);
      expect(posts).toEqual([]);
    });
  }

  test('still waiting when the plugin is uninstalled is skipped, and nothing reaches Slack', async () => {
    const ctx = await setup();
    await choose(ctx.asCamille, { enabled: true, target: HOOK });
    await assignLead(ctx);
    await uninstall(ctx.asLou);
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(ctx.t)).toMatchObject([
      { status: 'skipped', attempts: 0, error: 'channel_not_available' },
    ]);
    expect(posts).toEqual([]);
  });

  test('whose person took their webhook back while it waited is skipped', async () => {
    const ctx = await setup();
    await choose(ctx.asCamille, { enabled: true, target: HOOK });
    await assignLead(ctx);
    await choose(ctx.asCamille, { enabled: true, target: null });
    expect(await storedOf(ctx.t, ctx.camille.userId)).toEqual({ enabled: false });
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(ctx.t)).toMatchObject([
      { status: 'skipped', error: 'channel_disabled' },
    ]);
    expect(posts).toEqual([]);
  });
});

describe('the names switch of a plugin’s channel', () => {
  test('is the settings right’s, `full` until set, audited once per change, and only for a plugin’s channel that is installed', async () => {
    const { t, asLou, asCamille } = await setup();
    expect(await settingsOf(asLou)).toEqual({ label: 'Slack', names: 'full', targetSet: false });
    await expect(settingsOf(asCamille)).rejects.toThrow('Unauthorized');
    await expect(setNames(asCamille, 'none')).rejects.toThrow('Unauthorized');

    await setNames(asLou, 'none');
    await setNames(asLou, 'none');
    expect(await settingsOf(asLou)).toMatchObject({ names: 'none' });
    expect(await pluginAudits(t)).toMatchObject([
      { entityId: 'slack', action: 'update', metadata: { names: 'none' } },
    ]);

    // The core's own channel has no switch, nor a channel nobody knows.
    expect(await settingsOf(asLou, 'email')).toBeNull();
    for (const channel of ['email', 'carrier_pigeon']) {
      await expect(setNames(asLou, 'none', channel)).rejects.toMatchObject({
        data: { code: 'channel_not_available' },
      });
    }

    await uninstall(asLou);
    expect(await settingsOf(asLou)).toBeNull();
    await expect(setNames(asLou, 'full')).rejects.toMatchObject({
      data: { code: 'channel_not_available' },
    });
    // The choice is kept through the uninstall.
    await install(asLou);
    expect(await settingsOf(asLou)).toMatchObject({ names: 'none' });
  });

  test('on `none`, a message says the kind and gives the link, without the record’s name; the inbox still names it', async () => {
    const ctx = await setup();
    const { t, camille, asLou, asCamille } = ctx;
    await choose(asCamille, { enabled: true, target: HOOK });
    await setNames(asLou, 'none');
    const leadId = await assignLead(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(posts).toEqual([
      {
        url: HOOK,
        text: [
          '*Un lead vous est attribué*',
          `<https://crm.example.com/leads/${leadId}|Ouvrir dans le CRM>`,
        ].join('\n'),
      },
    ]);
    const inbox = await t.run((c) =>
      c.db
        .query('notifications')
        .withIndex('by_user_created', (q) => q.eq('userId', camille.userId))
        .collect(),
    );
    expect(inbox[0]!.title).toBe('Lead attribué : Jean Dupont');

    // Back on `full`, the next one carries the name again.
    await setNames(asLou, 'full');
    await assignLead(ctx, { firstName: 'Anne', lastName: 'Petit' });
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(posts.at(-1)!.text).toContain('Anne Petit');
  });
});

describe('« tester le canal »', () => {
  test('writes one message to the caller’s own webhook and says what Slack made of it', async () => {
    const { asLou, asCamille } = await setup();
    await expect(testChannel(asLou)).rejects.toMatchObject({
      data: { code: 'no_channel_target' },
    });
    await choose(asCamille, { enabled: true, target: HOOK });
    await choose(asLou, { enabled: false, target: HOOK_LOU });
    expect(await settingsOf(asLou)).toMatchObject({ targetSet: true });

    expect(await testChannel(asLou)).toBe('sent');
    expect(posts).toEqual([
      {
        url: HOOK_LOU,
        text: [
          '*Message de test*',
          'Ce canal fonctionne : vos notifications de Clinique Nord arriveront ici.',
          '<https://crm.example.com/settings/notifications|Ouvrir dans le CRM>',
        ].join('\n'),
      },
    ]);
    statuses.push(404, 500);
    expect(await testChannel(asLou)).toBe('refused');
    expect(await testChannel(asLou)).toBe('failed');
  });

  test('is every employee’s, to their own webhook, and only for a plugin’s channel that is installed', async () => {
    const { t, asLou, asCamille } = await setup();
    await expect(testChannel(asCamille)).rejects.toMatchObject({
      data: { code: 'no_channel_target' },
    });
    await choose(asCamille, { enabled: true, target: HOOK });
    await choose(asLou, { enabled: true, target: HOOK_LOU });
    expect(await testChannel(asCamille)).toBe('sent');
    expect(posts.map((post) => post.url)).toEqual([HOOK]);
    // A test that Slack refuses says so and leaves the channel as it is.
    statuses.push(404);
    expect(await testChannel(asCamille)).toBe('refused');
    expect(await read(asCamille)).toMatchObject({ channels: [{ enabled: true }] });
    await expect(
      t.action(api.features.notifications.actions.testNotificationChannel, {
        channel: 'slack',
      }),
    ).rejects.toThrow('Unauthorized');
    posts.length = 0;
    await expect(testChannel(asLou, 'email')).rejects.toMatchObject({
      data: { code: 'channel_not_available' },
    });
    await uninstall(asLou);
    await expect(testChannel(asLou)).rejects.toMatchObject({
      data: { code: 'channel_not_available' },
    });
    expect(posts).toEqual([]);
  });
});
