import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { uniformAccess } from '../../convex/_lib/validators/access';
import { emitEvent } from '../../convex/lib/notifications/emit';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from '../../convex/lib/notifications/channels';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runDue,
  seedConfig,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 10, 4, 9, 0, 0);
const ENV = ['BREVO_API_KEY', 'SECRETS_KEY', 'SECRETS_KEY_NEXT'] as const;
// Running the scheduled work lands the fake clock on the real time: the sessions must outlive that.
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

let saved: Record<string, string | undefined> = {};
const registered = NOTIFICATION_CHANNELS.length;
beforeEach(() => {
  pinClock(NOW);
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  NOTIFICATION_CHANNELS.length = registered;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** A channel as a plugin brings one: the person gives a secret address, the plugin must be installed. */
const pager: NotificationChannel = {
  key: 'pager',
  label: 'Pager',
  description: 'Sur votre pager.',
  plugin: 'landing-pages',
  target: {
    label: 'Adresse du pager',
    placeholder: 'https://pager.example.com/…',
    schema: z.string().startsWith('https://pager.example.com/'),
    secret: true,
  },
  isConfigured: async () => true,
  deliver: internal.features.notifications.actions.deliverEmail,
};

async function setup(config: { email?: boolean; plugins?: 'landing-pages'[] } = {}) {
  const t = createTestConvex();
  const lou = await seedEmployee(t, {
    email: 'lou.prefs@example.com',
    role: 'admin',
    firstName: 'Lou',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const camille = await seedEmployee(t, {
    email: 'camille.prefs@example.com',
    role: 'member',
    firstName: 'Camille',
    sessionTtlMs: SESSION_TTL_MS,
  });
  await seedConfig(t, {
    plugins: config.plugins ?? [],
    ...(config.email !== false && { email: { provider: 'brevo', brevoApiKey: 'xkeysib-test' } }),
  });
  return {
    t,
    lou,
    camille,
    asLou: asIdentity(t, lou.identity),
    asCamille: asIdentity(t, camille.identity),
  };
}

type Session = ReturnType<typeof asIdentity>;
const read = (as: Session) =>
  as.query(api.features.notifications.queries.getMyNotificationPreferences, {});
const update = (
  as: Session,
  choice: {
    kinds?: Record<string, boolean>;
    channels?: Record<string, { enabled: boolean; target?: string }>;
  },
) => as.mutation(api.features.notifications.mutations.updateMyNotificationPreferences, choice);
const storedOf = (t: T, userId: Id<'users'>) =>
  t.run((ctx) =>
    ctx.db
      .query('notificationPreferences')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
  );
const inboxOf = (t: T, userId: Id<'users'>) =>
  t.run((ctx) =>
    ctx.db
      .query('notifications')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .collect(),
  );
const deliveries = (t: T) => t.run((ctx) => ctx.db.query('notificationDeliveries').collect());
const off = (answer: Awaited<ReturnType<typeof read>>) =>
  answer.kinds.filter((kind) => !kind.on).map((kind) => kind.key);

describe('a person’s notification preferences', () => {
  test('until they choose, every kind follows the catalogue and no external channel is on; nothing is stored', async () => {
    const { t, lou, asLou } = await setup();
    const answer = await read(asLou);
    expect(answer.kinds).toHaveLength(10);
    expect(answer.kinds[0]).toEqual({
      key: 'lead.assigned',
      group: 'leads',
      label: 'Un lead vous est attribué',
      on: true,
    });
    expect(off(answer)).toEqual(['team.invitation_accepted']);
    expect(answer.channels).toEqual([
      {
        key: 'email',
        label: 'E-mail',
        description:
          'Chaque notification vous est aussi envoyée à l’adresse de votre compte, sauf si vous l’avez déjà lue dans le CRM.',
        enabled: false,
      },
    ]);
    expect(await storedOf(t, lou.userId)).toEqual([]);
  });

  test('only the kinds a role can receive are shown: not those of the settings right without it, not those of a module the role does not have', async () => {
    const { t, camille, asLou, asCamille } = await setup();
    const keys = async (as: Session) => (await read(as)).kinds.map((kind) => kind.key);
    const all = await keys(asLou);
    // A member has every module at « own » and no settings right.
    expect(await keys(asCamille)).toEqual(
      all.filter((key) => key !== 'workflow.run_failed' && key !== 'team.invitation_accepted'),
    );

    const support = await asLou.mutation(api.features.roles.mutations.createRole, {
      label: 'Support',
      access: { ...uniformAccess('own', false), deals: 'none', campaigns: 'none' },
    });
    await asLou.mutation(api.features.users.mutations.setEmployeeRole, {
      userId: camille.userId,
      role: support,
    });
    expect(await keys(asCamille)).toEqual([
      'lead.assigned',
      'lead.form_submitted',
      'activity.assigned',
      'import.finished',
    ]);

    // A choice made under another role is kept, and still accepted: the role may come back.
    await update(asCamille, { kinds: { 'deal.assigned': false } });
    expect((await storedOf(t, camille.userId))[0]!.kinds).toEqual({ 'deal.assigned': false });
    await asLou.mutation(api.features.users.mutations.setEmployeeRole, {
      userId: camille.userId,
      role: 'member',
    });
    expect(off(await read(asCamille))).toEqual(['deal.assigned']);
  });

  test('a choice is written over the ones already made, in one row, and is the person’s own', async () => {
    const { t, camille, asLou, asCamille } = await setup();
    await update(asCamille, { kinds: { 'deal.stage_changed': false } });
    await update(asCamille, {
      kinds: { 'import.finished': true },
      channels: { email: { enabled: true } },
    });
    const answer = await read(asCamille);
    expect(off(answer)).toEqual(['deal.stage_changed']);
    expect(answer.channels[0]).toMatchObject({ key: 'email', enabled: true });
    const rows = await storedOf(t, camille.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kinds: { 'deal.stage_changed': false, 'import.finished': true },
      channels: { email: { enabled: true } },
      updatedAt: NOW,
    });
    // Lou touched nothing.
    expect(off(await read(asLou))).toEqual(['team.invitation_accepted']);
    expect((await read(asLou)).channels[0]).toMatchObject({ enabled: false });

    await update(asCamille, { kinds: { 'deal.stage_changed': true } });
    expect(off(await read(asCamille))).toEqual([]);
    expect((await read(asCamille)).channels[0]).toMatchObject({ enabled: true });
  });

  test('a kind the catalogue does not hold, a channel that cannot deliver and a target a channel did not ask for are refused, and nothing is written', async () => {
    const { t, camille, asCamille } = await setup();
    await expect(update(asCamille, { kinds: { 'lead.deleted': false } })).rejects.toMatchObject({
      data: { code: 'unknown_notification_kind' },
    });
    await expect(
      update(asCamille, { channels: { carrier_pigeon: { enabled: true } } }),
    ).rejects.toMatchObject({ data: { code: 'channel_not_available' } });
    await expect(
      update(asCamille, { channels: { email: { enabled: true, target: 'else@example.com' } } }),
    ).rejects.toMatchObject({ data: { code: 'invalid_channel_target' } });
    expect(await storedOf(t, camille.userId)).toEqual([]);
  });

  test('without an e-mail provider the channel is neither shown nor accepted', async () => {
    const { asCamille } = await setup({ email: false });
    expect((await read(asCamille)).channels).toEqual([]);
    await expect(
      update(asCamille, { channels: { email: { enabled: true } } }),
    ).rejects.toMatchObject({ data: { code: 'channel_not_available' } });
  });

  test('a choice whose channel is no longer available stays in the row, inert, and is found again when the channel comes back', async () => {
    const { t, lou, camille, asCamille } = await setup();
    await update(asCamille, { channels: { email: { enabled: true } } });
    const config = await t.run((ctx) => ctx.db.query('appConfig').first());
    await t.run((ctx) => ctx.db.patch(config!._id, { email: undefined }));

    expect((await read(asCamille)).channels).toEqual([]);
    expect((await storedOf(t, camille.userId))[0]!.channels).toEqual({ email: { enabled: true } });
    // A kind toggled meanwhile leaves the entry alone.
    await update(asCamille, { kinds: { 'lead.assigned': true } });
    const leadId = await seedLead(t, { ownerIds: [camille.userId] });
    await t.run((ctx) =>
      emitEvent(ctx, {
        kind: 'lead.assigned',
        entity: { type: 'lead', id: leadId },
        actorId: lou.userId,
        data: { assigned: [camille.userId] },
      }),
    );
    await runDue(t);
    expect(await inboxOf(t, camille.userId)).toHaveLength(1);
    expect(await deliveries(t)).toEqual([]);

    await t.run((ctx) =>
      ctx.db.patch(config!._id, { email: { provider: 'brevo', brevoApiKey: 'xkeysib-test' } }),
    );
    expect((await read(asCamille)).channels[0]).toMatchObject({ key: 'email', enabled: true });
  });
});

describe('a channel that asks for a target', () => {
  test('is listed while its plugin is installed, and refused otherwise', async () => {
    NOTIFICATION_CHANNELS.push(pager);
    const without = await setup();
    expect((await read(without.asCamille)).channels.map((c) => c.key)).toEqual(['email']);
    await expect(
      update(without.asCamille, {
        channels: { pager: { enabled: true, target: 'https://pager.example.com/camille' } },
      }),
    ).rejects.toMatchObject({ data: { code: 'channel_not_available' } });

    const installed = await setup({ plugins: ['landing-pages'] });
    expect((await read(installed.asCamille)).channels.map((c) => c.key)).toEqual([
      'email',
      'pager',
    ]);
  });

  test('takes the target its schema accepts, keeps it as ciphertext, never returns it, and hands it in clear to its delivery', async () => {
    NOTIFICATION_CHANNELS.push(pager);
    process.env.SECRETS_KEY = 'a'.repeat(64);
    const { t, lou, camille, asCamille } = await setup({ plugins: ['landing-pages'] });
    const target = 'https://pager.example.com/camille';

    // Turned on without a target, or with one of another shape: refused.
    await expect(
      update(asCamille, { channels: { pager: { enabled: true } } }),
    ).rejects.toMatchObject({ data: { code: 'invalid_channel_target' } });
    await expect(
      update(asCamille, {
        channels: { pager: { enabled: true, target: 'https://elsewhere.example.com/x' } },
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid_channel_target' } });

    await update(asCamille, { channels: { pager: { enabled: true, target } } });
    const stored = (await storedOf(t, camille.userId))[0]!.channels.pager!;
    expect(stored.enabled).toBe(true);
    expect(stored.target).toMatch(/^v1:/);
    expect(JSON.stringify(await read(asCamille))).not.toContain('pager.example.com/camille');
    expect((await read(asCamille)).channels[1]).toEqual({
      key: 'pager',
      label: 'Pager',
      description: 'Sur votre pager.',
      enabled: true,
    });

    // Turned off and on again without giving it twice: the target is kept.
    await update(asCamille, { channels: { pager: { enabled: false } } });
    await update(asCamille, { channels: { pager: { enabled: true } } });
    expect((await storedOf(t, camille.userId))[0]!.channels.pager!.target).toBe(stored.target);

    const leadId = await seedLead(t, { ownerIds: [camille.userId] });
    await t.run((ctx) =>
      emitEvent(ctx, {
        kind: 'lead.assigned',
        entity: { type: 'lead', id: leadId },
        actorId: lou.userId,
        data: { assigned: [camille.userId] },
      }),
    );
    await runDue(t);
    const [delivery] = await deliveries(t);
    expect(delivery).toMatchObject({ channel: 'pager', status: 'pending', attempts: 0 });
    const job = await t.mutation(
      internal.features.notifications.internal.beginNotificationDelivery,
      { deliveryId: delivery!._id },
    );
    expect(job).toMatchObject({ to: target, path: `/leads/${leadId}` });
  });
});
