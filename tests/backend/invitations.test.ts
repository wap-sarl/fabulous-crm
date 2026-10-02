import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { INVITE_EMAIL } from '../../convex/auth/emailTemplates';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runDue,
  seedConfig,
  seedEmployee,
  type SeededEmployee,
  type T,
} from './helpers';

const NOW = Date.parse('2026-09-25T10:00:00Z');
const HOUR = 60 * 60 * 1000;
const ENV = ['BREVO_API_KEY', 'DEV_WHITELIST_EMAILS'] as const;
/** Addresses no other test file uses. */
const GUEST = 'guest.invitations@example.com';
const OTHER_GUEST = 'other.invitations@example.com';

let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
/** The mails the provider accepted, as their JSON bodies. */
let mails: { to: { email: string }[]; subject: string; htmlContent: string }[] = [];

beforeEach(() => {
  pinClock(NOW);
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  const mine: typeof mails = [];
  mails = mine;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    // Another file's background work is not ours: only a mail to our guests is answered.
    const ours =
      String(input).includes('brevo.com') && (body.includes(GUEST) || body.includes(OTHER_GUEST));
    if (!ours) return new Response(null, { status: 503 });
    mine.push(JSON.parse(body));
    return new Response(JSON.stringify({ messageId: 'm1' }), { status: 201 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function setup(config: { emailConfigured?: boolean } = {}) {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  await seedConfig(t, {
    appUrl: 'https://crm.example.com/',
    ...(config.emailConfigured !== false && {
      email: { provider: 'brevo', brevoApiKey: 'xkeysib-test' },
    }),
  });
  return {
    t,
    admin,
    as: asIdentity(t, admin.identity),
    asMember: asIdentity(t, member.identity),
  };
}

/** An invitation as `createInvitation` stores it, sent a day ago. */
const invite = (
  t: T,
  admin: SeededEmployee,
  email: string,
  status: 'pending' | 'accepted' | 'revoked' = 'pending',
) =>
  t.run((ctx) =>
    ctx.db.insert('invitations', {
      email,
      role: 'member',
      status,
      invitedBy: admin.userId,
      invitedAt: NOW - 24 * HOUR,
      ...(status === 'accepted' && { acceptedAt: NOW - HOUR }),
    }),
  );

const auditOf = (t: T, invitationId: Id<'invitations'>) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) =>
          q.eq('entityType', 'invitation').eq('entityId', invitationId),
        )
        .collect()
    ).map(({ action, userId, timestamp, metadata }) => ({ action, userId, timestamp, metadata })),
  );

const pendingMails = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.state.kind === 'pending' && job.name.includes('sendProviderEmail'))
      .map((job) => job.args[0] as { to: string; subject: string }),
  );

const isAllowed = (t: T, email: string) =>
  t.query(internal.features.invitations.internal.isAllowed, { email });

describe('who may create an account', () => {
  test('a live employee may, whatever the case and the spaces of the address', async () => {
    const { t } = await setup();
    expect(await isAllowed(t, 'member@example.com')).toBe(true);
    expect(await isAllowed(t, '  Member@Example.COM ')).toBe(true);
  });

  test('a pending invitation lets its address in', async () => {
    const { t, admin } = await setup();
    await invite(t, admin, GUEST);
    expect(await isAllowed(t, GUEST)).toBe(true);
    expect(await isAllowed(t, ` ${GUEST.toUpperCase()} `)).toBe(true);
  });

  test('an unknown address may not', async () => {
    const { t } = await setup();
    expect(await isAllowed(t, 'stranger@example.com')).toBe(false);
  });

  test('a deleted employee may not', async () => {
    const { t } = await setup();
    await seedEmployee(t, { email: 'left@example.com', deletedAt: NOW - HOUR });
    expect(await isAllowed(t, 'left@example.com')).toBe(false);
  });

  test('a revoked or an accepted invitation opens nothing', async () => {
    const { t, admin } = await setup();
    await invite(t, admin, GUEST, 'revoked');
    await invite(t, admin, OTHER_GUEST, 'accepted');
    expect(await isAllowed(t, GUEST)).toBe(false);
    expect(await isAllowed(t, OTHER_GUEST)).toBe(false);
  });
});

describe('sending an invitation again', () => {
  test('answers null, restarts its date, mails the guest and is audited', async () => {
    const { t, as, admin } = await setup();
    const invitationId = await invite(t, admin, GUEST);

    expect(
      await as.mutation(api.features.invitations.mutations.resendInvitation, { invitationId }),
    ).toBeNull();

    expect(await t.run((ctx) => ctx.db.get(invitationId))).toMatchObject({
      email: GUEST,
      status: 'pending',
      invitedAt: NOW,
    });
    expect(await auditOf(t, invitationId)).toEqual([
      {
        action: 'update',
        userId: admin.userId,
        timestamp: NOW,
        metadata: { email: GUEST, event: 'resent' },
      },
    ]);
    expect(await pendingMails(t)).toMatchObject([{ to: GUEST, subject: INVITE_EMAIL.subject }]);

    await runDue(t);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: [{ email: GUEST }], subject: INVITE_EMAIL.subject });
    // The button leads to the app, its trailing slash dropped.
    expect(mails[0].htmlContent).toContain('href="https://crm.example.com"');
  });

  test('the Brevo key of the environment is enough to send', async () => {
    const { t, as, admin } = await setup({ emailConfigured: false });
    process.env.BREVO_API_KEY = 'xkeysib-env';
    const invitationId = await invite(t, admin, GUEST);
    expect(
      await as.mutation(api.features.invitations.mutations.resendInvitation, { invitationId }),
    ).toBeNull();
    await runDue(t);
    expect(mails.map((mail) => mail.to)).toEqual([[{ email: GUEST }]]);
  });

  test('an address outside the dev whitelist is not mailed, the rest is done', async () => {
    const { t, as, admin } = await setup();
    process.env.DEV_WHITELIST_EMAILS = OTHER_GUEST;
    const invitationId = await invite(t, admin, GUEST);

    expect(
      await as.mutation(api.features.invitations.mutations.resendInvitation, { invitationId }),
    ).toBeNull();

    expect(await pendingMails(t)).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(invitationId)))?.invitedAt).toBe(NOW);
    expect(await auditOf(t, invitationId)).toHaveLength(1);
  });

  test('is refused when no e-mail provider is configured, and nothing is written', async () => {
    const { t, as, admin } = await setup({ emailConfigured: false });
    const invitationId = await invite(t, admin, GUEST);
    await expect(
      as.mutation(api.features.invitations.mutations.resendInvitation, { invitationId }),
    ).rejects.toMatchObject({ data: { code: 'email_not_configured' } });
    expect((await t.run((ctx) => ctx.db.get(invitationId)))?.invitedAt).toBe(NOW - 24 * HOUR);
    expect(await auditOf(t, invitationId)).toEqual([]);
    expect(await pendingMails(t)).toEqual([]);
  });

  test('is refused for an invitation that is no longer pending, or unknown', async () => {
    const { t, as, admin } = await setup();
    const revoked = await invite(t, admin, GUEST, 'revoked');
    const accepted = await invite(t, admin, OTHER_GUEST, 'accepted');
    for (const invitationId of [revoked, accepted]) {
      await expect(
        as.mutation(api.features.invitations.mutations.resendInvitation, { invitationId }),
      ).rejects.toMatchObject({ data: { code: 'invitation_not_pending' } });
    }
    await t.run((ctx) => ctx.db.delete(revoked));
    await expect(
      as.mutation(api.features.invitations.mutations.resendInvitation, { invitationId: revoked }),
    ).rejects.toMatchObject({ data: { code: 'invitation_not_found' } });
    expect(await pendingMails(t)).toEqual([]);
  });

  test('is refused without the settings access', async () => {
    const { t, asMember, admin } = await setup();
    const invitationId = await invite(t, admin, GUEST);
    await expect(
      asMember.mutation(api.features.invitations.mutations.resendInvitation, { invitationId }),
    ).rejects.toThrow('Unauthorized: settings access');
  });
});

describe('revoking an invitation', () => {
  test('answers null, closes the door and is audited', async () => {
    const { t, as, admin } = await setup();
    const invitationId = await as.mutation(api.features.invitations.mutations.createInvitation, {
      email: ` ${GUEST.toUpperCase()} `,
      role: 'manager',
    });
    const kept = await invite(t, admin, OTHER_GUEST);
    jest.setSystemTime(new Date(NOW + HOUR / 2));

    expect(
      await as.mutation(api.features.invitations.mutations.revokeInvitation, { invitationId }),
    ).toBeNull();

    expect(await t.run((ctx) => ctx.db.get(invitationId))).toMatchObject({
      email: GUEST,
      role: 'manager',
      status: 'revoked',
      invitedBy: admin.userId,
      invitedAt: NOW,
    });
    expect(await auditOf(t, invitationId)).toEqual([
      {
        action: 'create',
        userId: admin.userId,
        timestamp: NOW,
        metadata: { email: GUEST, role: 'manager' },
      },
      {
        action: 'update',
        userId: admin.userId,
        timestamp: NOW + HOUR / 2,
        metadata: { email: GUEST, event: 'revoked' },
      },
    ]);
    expect(await isAllowed(t, GUEST)).toBe(false);
    const listed = await as.query(api.features.invitations.queries.listInvitations, {});
    expect(listed.map((row) => row._id)).toEqual([kept]);
  });

  test('is refused for an invitation already revoked, accepted, or unknown', async () => {
    const { t, as, admin } = await setup();
    const revoked = await invite(t, admin, GUEST);
    await as.mutation(api.features.invitations.mutations.revokeInvitation, {
      invitationId: revoked,
    });
    const accepted = await invite(t, admin, OTHER_GUEST, 'accepted');
    for (const invitationId of [revoked, accepted]) {
      await expect(
        as.mutation(api.features.invitations.mutations.revokeInvitation, { invitationId }),
      ).rejects.toMatchObject({ data: { code: 'invitation_not_pending' } });
    }
    expect((await t.run((ctx) => ctx.db.get(accepted)))?.status).toBe('accepted');
    // One revocation, one audit row.
    expect(await auditOf(t, revoked)).toHaveLength(1);

    await t.run((ctx) => ctx.db.delete(accepted));
    await expect(
      as.mutation(api.features.invitations.mutations.revokeInvitation, { invitationId: accepted }),
    ).rejects.toMatchObject({ data: { code: 'invitation_not_found' } });
  });

  test('is refused without the settings access', async () => {
    const { t, asMember, admin } = await setup();
    const invitationId = await invite(t, admin, GUEST);
    await expect(
      asMember.mutation(api.features.invitations.mutations.revokeInvitation, { invitationId }),
    ).rejects.toThrow('Unauthorized: settings access');
    expect((await t.run((ctx) => ctx.db.get(invitationId)))?.status).toBe('pending');
  });
});
