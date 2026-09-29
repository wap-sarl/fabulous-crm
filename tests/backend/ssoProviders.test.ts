import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { ssoProviderIdSchema } from '../../convex/_lib/validators/appConfig';
import { asIdentity, createTestConvex, seedConfig, seedEmployee, type T } from './helpers';

let savedToken: string | undefined;
beforeEach(() => {
  savedToken = process.env.SETUP_TOKEN;
  process.env.SETUP_TOKEN = 'setup-token';
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.SETUP_TOKEN;
  else process.env.SETUP_TOKEN = savedToken;
});

const provider = (providerId: string, enabled = true) => ({
  providerId,
  label: 'Acme',
  issuerUrl: 'https://id.acme.example',
  clientId: 'cid',
  clientSecret: 'secret',
  scopes: ['openid'],
  enabled,
});

const setup = (t: T, providerIds: string[], enabled = true) =>
  t.mutation(api.setup.mutations.completeSetup, {
    setupToken: 'setup-token',
    organizationName: 'Acme',
    appUrl: 'https://crm.acme.example',
    senderEmail: 'crm@acme.example',
    senderName: 'Acme',
    auth: { magicLinkEnabled: true, ssoProviders: providerIds.map((id) => provider(id, enabled)) },
    admin: { email: 'admin@acme.example', firstName: 'Ada', lastName: 'Admin' },
  });

const storedIds = (t: T) =>
  t.run(async (ctx) =>
    ((await ctx.db.query('appConfig').first())?.auth.ssoProviders ?? []).map((p) => p.providerId),
  );

describe('the id of a sign-in provider', () => {
  test('is lowercase words joined by hyphens, 64 characters at most', () => {
    for (const id of ['acme', 'mon-entreprise', 'sso2', 'a-1-b', 'a'.repeat(64)]) {
      expect(ssoProviderIdSchema.safeParse(id).success).toBe(true);
    }
    for (const id of [
      '',
      'Acme',
      'société',
      'mon entreprise',
      'mon_entreprise',
      'mon--entreprise',
      '-acme',
      'acme-',
      'acme/../x',
      ' acme',
      'a'.repeat(65),
    ]) {
      expect(ssoProviderIdSchema.safeParse(id).success).toBe(false);
    }
  });

  test('the setup stores the ids that follow the rule', async () => {
    const t = createTestConvex();
    await setup(t, ['acme', 'mon-entreprise']);
    expect(await storedIds(t)).toEqual(['acme', 'mon-entreprise']);
  });

  test('the setup refuses an id that does not, of a provider that is off too, and stores nothing', async () => {
    for (const id of ['Acme', 'acme/../x', 'mon-', '']) {
      const t = createTestConvex();
      await expect(setup(t, ['ok', id], false)).rejects.toThrow(/sso_provider_invalid_id/);
      expect(await t.run((ctx) => ctx.db.query('appConfig').first())).toBeNull();
      expect(await t.run((ctx) => ctx.db.query('users').first())).toBeNull();
    }
  });

  test('the setup refuses the same id twice', async () => {
    const t = createTestConvex();
    await expect(setup(t, ['acme', 'acme'])).rejects.toThrow(/sso_provider_duplicate_id/);
  });

  test('the settings refuse a new id that does not follow the rule, and keep one already stored as it is', async () => {
    const t = createTestConvex();
    const employee = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
    const admin = asIdentity(t, employee.identity);
    await seedConfig(t, { auth: { magicLinkEnabled: true, ssoProviders: [provider('Old_ID')] } });
    const update = (ids: string[]) =>
      admin.mutation(api.features.config.mutations.updateConfig, {
        ssoProviders: ids.map((id) => provider(id)),
      });
    await expect(update(['Old_ID', 'New ID'])).rejects.toThrow(/sso_provider_invalid_id/);
    await expect(update(['Old_ID', 'new-id', 'new-id'])).rejects.toThrow(
      /sso_provider_duplicate_id/,
    );
    expect(await storedIds(t)).toEqual(['Old_ID']);
    await update(['Old_ID', 'new-id']);
    expect(await storedIds(t)).toEqual(['Old_ID', 'new-id']);
  });
});
