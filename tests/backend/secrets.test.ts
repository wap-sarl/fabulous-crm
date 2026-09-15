import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../../convex/lib/crypto';
import { resolveBrevo, resolveEmailProvider } from '../../convex/lib/emailProvider';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const ENV = ['SECRETS_KEY', 'SECRETS_KEY_NEXT', 'BREVO_API_KEY', 'BREVO_WEBHOOK_SECRET'] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const CIPHERTEXT = /^v1:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/;

async function seedConfig(t: T, email?: Record<string, string>) {
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'WAP',
      appUrl: 'http://localhost:4202',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: {
        magicLinkEnabled: true,
        socialProviders: [
          { id: 'google', clientId: 'gid', clientSecret: 'google-clear', enabled: true },
        ],
      },
      ...(email ? { email: { provider: 'brevo' as const, ...email } } : {}),
      updatedAt: Date.now(),
    }),
  );
  return asIdentity(t, emp.identity);
}

const storedConfig = (t: T) => t.run((ctx) => ctx.db.query('appConfig').first());

describe('secrets at rest', () => {
  test('encrypts to versioned ciphertext that only the key decrypts, one nonce per write', async () => {
    process.env.SECRETS_KEY = KEY_A;
    const one = await encryptSecret('xkeysib-hello');
    const two = await encryptSecret('xkeysib-hello');
    expect(one).toMatch(CIPHERTEXT);
    expect(one).not.toBe(two);
    expect(isEncryptedSecret(one)).toBe(true);
    expect(await decryptSecret(one)).toBe('xkeysib-hello');
    expect(await encryptSecret('')).toBe('');
    // A value written before encryption reads back as is.
    expect(await decryptSecret('legacy-clear')).toBe('legacy-clear');
    expect(isEncryptedSecret('legacy-clear')).toBe(false);

    process.env.SECRETS_KEY = KEY_B;
    await expect(decryptSecret(one)).rejects.toThrow(/secret_key_mismatch/);
    delete process.env.SECRETS_KEY;
    await expect(decryptSecret(one)).rejects.toThrow(/secret_key_missing/);
    process.env.SECRETS_KEY = 'short';
    await expect(encryptSecret('x')).rejects.toThrow(/32 bytes in hex/);
  });

  test('keeps secrets in clear without a key, the community edition, and says so', async () => {
    expect(await encryptSecret('xkeysib-clear')).toBe('xkeysib-clear');
    expect(await decryptSecret('xkeysib-clear')).toBe('xkeysib-clear');
  });

  test('rotates: SECRETS_KEY_NEXT encrypts new writes and both keys decrypt', async () => {
    process.env.SECRETS_KEY = KEY_A;
    const old = await encryptSecret('secret');
    process.env.SECRETS_KEY_NEXT = KEY_B;
    expect(await decryptSecret(old)).toBe('secret');
    const fresh = await encryptSecret('secret');
    delete process.env.SECRETS_KEY_NEXT;
    process.env.SECRETS_KEY = KEY_B;
    expect(await decryptSecret(fresh)).toBe('secret');
    await expect(decryptSecret(old)).rejects.toThrow(/secret_key_mismatch/);
  });

  test('the settings mutation stores ciphertext, the resolvers and the auth read the clear value, no query returns it', async () => {
    process.env.SECRETS_KEY = KEY_A;
    const t = createTestConvex();
    const as = await seedConfig(t);
    await as.mutation(api.features.config.mutations.updateConfig, {
      email: { provider: 'brevo', brevoApiKey: 'xkeysib-stored', brevoWebhookSecret: 'wh-stored' },
      socialProviders: [
        { id: 'google', clientId: 'gid', clientSecret: 'google-new', enabled: true },
      ],
      ssoProviders: [
        {
          providerId: 'acme',
          label: 'Acme',
          issuerUrl: 'https://id.acme.example',
          clientId: 'cid',
          clientSecret: 'sso-new',
          scopes: ['openid'],
          enabled: true,
        },
      ],
    });
    const cfg = await storedConfig(t);
    expect(cfg?.email?.brevoApiKey).toMatch(CIPHERTEXT);
    expect(cfg?.email?.brevoWebhookSecret).toMatch(CIPHERTEXT);
    expect(cfg?.auth.socialProviders?.[0]?.clientSecret).toMatch(CIPHERTEXT);
    expect(cfg?.auth.ssoProviders?.[0]?.clientSecret).toMatch(CIPHERTEXT);
    const brevo = await resolveBrevo(cfg);
    expect(brevo.apiKey).toBe('xkeysib-stored');
    expect(brevo.webhookSecret).toBe('wh-stored');
    const provider = await resolveEmailProvider(cfg);
    expect(provider.kind === 'brevo' && provider.apiKey).toBe('xkeysib-stored');
    // An omitted secret keeps the stored ciphertext; the admin view only shows presence.
    await as.mutation(api.features.config.mutations.updateConfig, {
      email: { provider: 'brevo', brevoSmsSender: 'WAP' },
    });
    const kept = await storedConfig(t);
    expect(kept?.email?.brevoApiKey).toBe(cfg?.email?.brevoApiKey);
    const admin = await as.query(api.features.config.queries.getAdminConfig, {});
    const shown = JSON.stringify(admin);
    expect(admin).toMatchObject({
      email: { hasBrevoApiKey: true, hasBrevoWebhookSecret: true, smsAvailable: true },
    });
    for (const clear of ['xkeysib-stored', 'wh-stored', 'google-new', 'sso-new']) {
      expect(shown).not.toContain(clear);
    }
    expect(
      JSON.stringify(await t.query(api.features.config.queries.getPublicConfig, {})),
    ).not.toContain('google-new');
  });

  test('the migration encrypts clear values once, and the rotation re-encrypts with the next key', async () => {
    process.env.SECRETS_KEY = KEY_A;
    const t = createTestConvex();
    await seedConfig(t, { brevoApiKey: 'brevo-clear', smtpPass: 'smtp-clear' });
    await t.mutation(internal.migrations.encryptAppConfigSecrets, {});
    const encrypted = await storedConfig(t);
    expect(encrypted?.email?.brevoApiKey).toMatch(CIPHERTEXT);
    expect(encrypted?.email?.smtpPass).toMatch(CIPHERTEXT);
    // A field that was absent stays absent: nothing invents an empty secret.
    expect(encrypted?.email?.brevoWebhookSecret).toBeUndefined();
    expect(encrypted?.auth.ssoProviders).toBeUndefined();
    expect(encrypted?.auth.socialProviders?.[0]?.clientSecret).toMatch(CIPHERTEXT);
    expect(await decryptSecret(encrypted?.auth.socialProviders?.[0]?.clientSecret ?? '')).toBe(
      'google-clear',
    );
    expect((await resolveBrevo(encrypted)).apiKey).toBe('brevo-clear');
    // Idempotent: a second run leaves the ciphertext alone.
    await t.mutation(internal.migrations.encryptAppConfigSecrets, {});
    expect((await storedConfig(t))?.email?.brevoApiKey).toBe(encrypted?.email?.brevoApiKey);

    process.env.SECRETS_KEY_NEXT = KEY_B;
    await t.mutation(internal.migrations.rotateAppConfigSecrets, {});
    const rotated = await storedConfig(t);
    expect(rotated?.email?.brevoApiKey).not.toBe(encrypted?.email?.brevoApiKey);
    delete process.env.SECRETS_KEY_NEXT;
    process.env.SECRETS_KEY = KEY_B;
    expect((await resolveBrevo(rotated)).apiKey).toBe('brevo-clear');
    expect(await decryptSecret(rotated?.auth.socialProviders?.[0]?.clientSecret ?? '')).toBe(
      'google-clear',
    );
  });
});
