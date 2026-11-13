import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { NOTIFICATION_DELIVERY_HOLD_MS } from '../../convex/_lib/validators/notifications';
import { discordMessage } from '../../convex/lib/notifications/channels/discord';
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

const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
const MINUTE = 60_000;
const ENV = ['BREVO_API_KEY', 'SECRETS_KEY', 'SECRETS_KEY_NEXT'] as const;
// Running the scheduled work lands the fake clock on the real time: the sessions must outlive that.
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Webhooks no other test file uses: the id marks them as ours. */
const HOOK = 'https://discord.com/api/webhooks/1230000000000000001/camille-Secret_Token';
const HOOK_OLD_HOST = 'https://discordapp.com/api/webhooks/1230000000000000002/louSecretToken';

let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
/** Discord's side: every message it was sent and where, and what it answers, in order (204 once none is left); `down` makes the call itself fail. */
let posts: { url: string; body: Record<string, unknown> }[] = [];
let statuses: (number | 'down')[] = [];

beforeEach(() => {
  pinClock(NOW);
  // The delays this file advances to are exact: no share of chance on top.
  pinDice(0);
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.SECRETS_KEY = 'a'.repeat(64);
  const mine: { url: string; body: Record<string, unknown> }[] = [];
  const queue: (number | 'down')[] = [];
  posts = mine;
  statuses = queue;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    // Another file's background work is not ours: only our webhooks are answered.
    if (!url.includes('/webhooks/123000000000000000')) return new Response(null, { status: 503 });
    mine.push({ url, body: JSON.parse(String(init?.body)) });
    const status = queue.shift() ?? 204;
    if (status === 'down') throw new TypeError(`fetch failed: ${url}`);
    return new Response(status === 204 ? null : '{"message":"no"}', { status });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Lou (admin) acts and administers; Camille (member) is told. No e-mail provider: Discord is the only channel there can be. */
async function setup(plugins: string[] = ['discord']) {
  const t = createTestConvex();
  const lou = await seedEmployee(t, {
    email: 'lou.discord@example.com',
    role: 'admin',
    firstName: 'Lou',
    lastName: 'Martin',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const camille = await seedEmployee(t, {
    email: 'camille.discord@example.com',
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
const choose = (as: Session, discord: { enabled: boolean; target?: string | null }) =>
  as.mutation(api.features.notifications.mutations.updateMyNotificationPreferences, {
    channels: { discord },
  });
const storedOf = async (t: T, userId: Id<'users'>) =>
  (
    await t.run((ctx) =>
      ctx.db
        .query('notificationPreferences')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .first(),
    )
  )?.channels.discord;
const deliveries = (t: T) => t.run((ctx) => ctx.db.query('notificationDeliveries').collect());
const setNames = (as: Session, names: 'full' | 'none') =>
  as.mutation(api.features.notifications.mutations.updateNotificationChannelSettings, {
    channel: 'discord',
    names,
  });
const testChannel = (as: Session) =>
  as.action(api.features.notifications.actions.testNotificationChannel, { channel: 'discord' });
const install = (as: Session) =>
  as.mutation(api.features.plugins.mutations.installPlugin, { key: 'discord' });
const uninstall = (as: Session) =>
  as.mutation(api.features.plugins.mutations.uninstallPlugin, { key: 'discord' });

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

describe('the Discord channel', () => {
  test('is there while the plugin is installed, after Slack’s in the list: uninstalled it is neither shown nor accepted, and a reinstall finds the person’s choice', async () => {
    const ctx = await setup([]);
    const { t, camille, asLou, asCamille } = ctx;
    expect((await read(asCamille)).channels).toEqual([]);
    await expect(choose(asCamille, { enabled: true, target: HOOK })).rejects.toMatchObject({
      data: { code: 'channel_not_available' },
    });

    await asLou.mutation(api.features.plugins.mutations.installPlugin, { key: 'slack' });
    await install(asLou);
    expect((await read(asCamille)).channels.map((channel) => channel.key)).toEqual([
      'slack',
      'discord',
    ]);
    expect((await read(asCamille)).channels[1]).toEqual({
      key: 'discord',
      label: 'Discord',
      description: expect.stringContaining('webhook de votre salon'),
      enabled: false,
      target: {
        label: 'URL du webhook de votre salon',
        placeholder: 'https://discord.com/api/webhooks/…',
        set: false,
      },
    });
    await choose(asCamille, { enabled: true, target: HOOK });
    expect((await read(asCamille)).channels[1]).toMatchObject({
      enabled: true,
      target: { set: true, hint: 'discord.com · 1230000000000000001' },
    });

    await uninstall(asLou);
    expect((await read(asCamille)).channels.map((channel) => channel.key)).toEqual(['slack']);
    await expect(choose(asCamille, { enabled: false })).rejects.toMatchObject({
      data: { code: 'channel_not_available' },
    });
    // Nothing is told to Discord meanwhile, and no delivery is written for it.
    await assignLead(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(t)).toEqual([]);
    expect(posts).toEqual([]);

    await install(asLou);
    expect((await read(asCamille)).channels[1]).toMatchObject({
      enabled: true,
      target: { set: true, hint: 'discord.com · 1230000000000000001' },
    });
    expect((await storedOf(t, camille.userId))?.enabled).toBe(true);
  });

  test('takes a channel webhook of discord.com, under any of Discord’s hosts, and nothing else, keeps it as ciphertext under discord.com, and says only its host and its id', async () => {
    const { t, camille, asCamille } = await setup();
    for (const target of [
      'http://discord.com/api/webhooks/1230000000000000001/camille-Secret_Token',
      'https://discord.com.example.com/api/webhooks/1230000000000000001/camille-Secret_Token',
      'https://example.com/api/webhooks/1230000000000000001/camille-Secret_Token',
      'https://discord.com/api/webhooks/1230000000000000001',
      'https://discord.com/api/webhooks/notanid/camille-Secret_Token',
      'https://discord.com/api/webhooks/1230000000000000001/camille-Secret_Token?wait=true',
      'https://discord.com/api/webhooks/1230000000000000001/camille-Secret_Token/slack',
      'https://discord.com@example.com/api/webhooks/1230000000000000001/camille-Secret_Token',
      'https://hooks.slack.com/services/T0SLACKTEST/B0CAMILLE/camilleSecret',
      '',
    ]) {
      await expect(choose(asCamille, { enabled: true, target })).rejects.toMatchObject({
        data: { code: 'invalid_channel_target' },
      });
    }
    expect(await storedOf(t, camille.userId)).toBeUndefined();

    await choose(asCamille, { enabled: true, target: ` ${HOOK}\n` });
    const stored = await storedOf(t, camille.userId);
    expect(stored).toMatchObject({ enabled: true, hint: 'discord.com · 1230000000000000001' });
    expect(stored!.target).toMatch(/^v1:/);
    expect(JSON.stringify(stored)).not.toContain('Secret_Token');
    expect(JSON.stringify(await read(asCamille))).not.toContain('Secret_Token');

    // Discord's other hosts name the same webhook: kept as discord.com, written to there.
    for (const host of ['discordapp.com', 'ptb.discord.com', 'canary.discord.com']) {
      await choose(asCamille, { enabled: true, target: HOOK.replace('discord.com', host) });
      expect((await storedOf(t, camille.userId))!.hint).toBe('discord.com · 1230000000000000001');
    }
    expect(await testChannel(asCamille)).toBe('sent');
    expect(posts.at(-1)!.url).toBe(HOOK);
  });
});

describe('a notification delivered to Discord', () => {
  test('Camille pastes her webhook: the next lead assigned to her lands in her channel with its name and a link that opens it, mentioning no one; Lou, who gave none, gets nothing', async () => {
    const ctx = await setup();
    const { t, asCamille } = ctx;
    await choose(asCamille, { enabled: true, target: HOOK });
    const leadId = await assignLead(ctx);
    expect(posts).toEqual([]);
    expect(await deliveries(t)).toMatchObject([{ channel: 'discord', status: 'pending' }]);

    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(posts).toEqual([
      {
        url: HOOK,
        body: {
          content: [
            '**Lead attribué : Jean Dupont**',
            'Lou Martin vous a attribué le lead Jean Dupont.',
            `[Ouvrir dans le CRM](<https://crm.example.com/leads/${leadId}>)`,
          ].join('\n'),
          allowed_mentions: { parse: [] },
        },
      },
    ]);
    expect(await deliveries(t)).toMatchObject([
      { channel: 'discord', status: 'sent', attempts: 1 },
    ]);
  });

  test('writes the words of a record as they are: nothing in a name is read as Discord markup, a mention or a heading, and the text fits Discord’s limit', () => {
    expect(
      discordMessage({
        title: 'Lead attribué : @everyone *Dupont* <#123> [x](y)',
        body: '# Titre\n> cité\n- liste\nA_B | `c` ~d~ \\e',
        url: 'https://crm.example.com/leads/1',
      }),
    ).toEqual({
      content: [
        '**Lead attribué : @everyone \\*Dupont\\* \\<#123> \\[x\\](y)**',
        '\\# Titre\n\\> cité\n\\- liste\nA\\_B \\| \\`c\\` \\~d\\~ \\\\e',
        '[Ouvrir dans le CRM](<https://crm.example.com/leads/1>)',
      ].join('\n'),
      allowed_mentions: { parse: [] },
    });
    const url = 'https://crm.example.com/leads/1';
    const link = `[Ouvrir dans le CRM](<${url}>)`;
    const long = discordMessage({ title: 'T', body: 'x'.repeat(3000), url });
    expect(long.content.length).toBeLessThanOrEqual(2000);
    expect(long.content.endsWith(`…\n${link}`)).toBe(true);
    // An emoji is two units: the cut lands between code points, never inside one.
    const emoji = discordMessage({ title: 'T', body: '😀'.repeat(1500), url });
    expect(emoji.content.length).toBeLessThanOrEqual(2000);
    expect(emoji.content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(emoji.content).toMatch(/😀…\n\[Ouvrir/);
    // A title alone can be too long: it is cut too, the body gives way, the link is whole.
    const title = discordMessage({ title: '🙂'.repeat(1200), body: 'Texte', url });
    expect(title.content.length).toBeLessThanOrEqual(2000);
    expect(title.content).toMatch(/^\*\*🙂+…\*\*\n\[Ouvrir/u);
    expect(title.content.endsWith(link)).toBe(true);
    expect(title.content).not.toContain('Texte');
    expect(
      discordMessage({ title: 'T', body: '', url: 'https://crm.example.com/leads/1' }).content,
    ).toBe('**T**\n[Ouvrir dans le CRM](<https://crm.example.com/leads/1>)');
  });

  test('that Discord refuses for good (a deleted webhook, a wrong token) is skipped at once and turns the person’s channel off', async () => {
    const ctx = await setup();
    const { t, camille, asCamille } = ctx;
    await choose(asCamille, { enabled: true, target: HOOK });
    statuses.push(404);
    await assignLead(ctx);
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(t)).toMatchObject([{ status: 'skipped', error: 'target_refused' }]);
    const refused = await storedOf(t, camille.userId);
    expect(refused).toMatchObject({ enabled: false });
    expect(refused!.refusedAt).toEqual(expect.any(Number));

    // A new webhook: the channel is on again; a 401 is a wrong token, refused the same way.
    await choose(asCamille, { enabled: true, target: HOOK_OLD_HOST });
    statuses.push(401);
    await assignLead(ctx, { firstName: 'Anne', lastName: 'Petit' });
    await runAfter(t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect((await deliveries(t)).at(-1)).toMatchObject({
      status: 'skipped',
      error: 'target_refused',
    });
    expect((await storedOf(t, camille.userId))!.enabled).toBe(false);
    expect(posts).toHaveLength(2);
  });

  test('that Discord cannot take now is tried again, whether it is rate-limited, down, answering 500 or 400: the channel stays on', async () => {
    const ctx = await setup();
    await choose(ctx.asCamille, { enabled: true, target: HOOK });
    statuses.push(429, 'down', 500, 400);
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
    expect((await deliveries(ctx.t))[0]).toMatchObject({ status: 'sent', attempts: 5 });
    expect((await storedOf(ctx.t, ctx.camille.userId))!.enabled).toBe(true);
  });

  test('on `none`, a message says the kind and gives the link, without the record’s name', async () => {
    const ctx = await setup();
    await choose(ctx.asCamille, { enabled: true, target: HOOK });
    await setNames(ctx.asLou, 'none');
    const leadId = await assignLead(ctx);
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(posts[0]!.body.content).toBe(
      `**Un lead vous est attribué**\n[Ouvrir dans le CRM](<https://crm.example.com/leads/${leadId}>)`,
    );
  });

  test('still waiting when the plugin is uninstalled is skipped, and nothing reaches Discord', async () => {
    const ctx = await setup();
    await choose(ctx.asCamille, { enabled: true, target: HOOK });
    await assignLead(ctx);
    await uninstall(ctx.asLou);
    await runAfter(ctx.t, NOTIFICATION_DELIVERY_HOLD_MS);
    expect(await deliveries(ctx.t)).toMatchObject([
      { status: 'skipped', error: 'channel_not_available' },
    ]);
    expect(posts).toEqual([]);
  });

  test('« tester » writes one message to the caller’s own webhook and says what Discord made of it', async () => {
    const ctx = await setup();
    await choose(ctx.asCamille, { enabled: true, target: HOOK });
    expect(await testChannel(ctx.asCamille)).toBe('sent');
    expect(posts[0]).toMatchObject({ url: HOOK });
    expect(posts[0]!.body.content).toContain('**Message de test**');
    expect(posts[0]!.body.content).toContain('Clinique Nord');
    statuses.push(404, 500);
    expect(await testChannel(ctx.asCamille)).toBe('refused');
    expect(await testChannel(ctx.asCamille)).toBe('failed');
    await expect(testChannel(ctx.asLou)).rejects.toMatchObject({
      data: { code: 'no_channel_target' },
    });
  });
});
