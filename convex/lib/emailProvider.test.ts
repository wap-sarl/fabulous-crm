import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { isEmailProviderConfigured, resolveBrevo, resolveEmailProvider } from './emailProvider';
import type { AppConfig } from '../_lib/validators/appConfig';

// Minimal config factory — only the fields the resolvers read.
function cfg(email?: AppConfig['email'], sender?: Partial<AppConfig>): AppConfig {
  return {
    organizationName: 'Org',
    appUrl: 'https://crm.local',
    senderEmail: sender?.senderEmail ?? 'from@crm.local',
    senderName: sender?.senderName ?? 'CRM',
    auth: { magicLinkEnabled: true },
    email,
    updatedAt: 0,
  } as AppConfig;
}

const ENV_KEYS = ['BREVO_API_KEY', 'BREVO_WEBHOOK_SECRET', 'BREVO_SMS_SENDER', 'EMAIL_SENDER_EMAIL', 'EMAIL_SENDER_NAME'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveEmailProvider', () => {
  it('defaults to Brevo when email config is absent', () => {
    const r = resolveEmailProvider(cfg(undefined));
    expect(r.kind).toBe('brevo');
  });

  it('falls back to the env Brevo API key when config value is empty', () => {
    process.env.BREVO_API_KEY = 'env-key';
    const r = resolveEmailProvider(cfg({ provider: 'brevo' }));
    expect(r).toEqual({ kind: 'brevo', apiKey: 'env-key', sender: { name: 'CRM', email: 'from@crm.local' } });
  });

  it('prefers the stored Brevo API key over the env var', () => {
    process.env.BREVO_API_KEY = 'env-key';
    const r = resolveEmailProvider(cfg({ provider: 'brevo', brevoApiKey: 'stored-key' }));
    expect(r.kind === 'brevo' && r.apiKey).toBe('stored-key');
  });

  it('resolves SMTP settings with defaults for missing port/secure', () => {
    const r = resolveEmailProvider(cfg({ provider: 'smtp', smtpHost: 'smtp.example.com', smtpUser: 'u', smtpPass: 'p' }));
    expect(r).toEqual({
      kind: 'smtp',
      smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'u', pass: 'p' },
      sender: { name: 'CRM', email: 'from@crm.local' },
    });
  });
});

describe('isEmailProviderConfigured', () => {
  it('is false for Brevo with no API key (config or env)', () => {
    expect(isEmailProviderConfigured(resolveEmailProvider(cfg({ provider: 'brevo' })))).toBe(false);
  });

  it('is true for Brevo once a key resolves (env fallback counts)', () => {
    process.env.BREVO_API_KEY = 'env-key';
    expect(isEmailProviderConfigured(resolveEmailProvider(cfg({ provider: 'brevo' })))).toBe(true);
  });

  it('is false for SMTP with no host', () => {
    expect(isEmailProviderConfigured(resolveEmailProvider(cfg({ provider: 'smtp', smtpUser: 'u' })))).toBe(false);
  });

  it('is true for SMTP with a host', () => {
    expect(
      isEmailProviderConfigured(resolveEmailProvider(cfg({ provider: 'smtp', smtpHost: 'smtp.example.com' })))
    ).toBe(true);
  });
});

describe('resolveBrevo', () => {
  it('marks SMS available whenever an API key resolves (independent of email provider)', () => {
    const r = resolveBrevo(cfg({ provider: 'smtp', smtpHost: 'h', brevoApiKey: 'k' }));
    expect(r.smsAvailable).toBe(true);
    expect(r.emailIsBrevo).toBe(false);
  });

  it('marks SMS unavailable when no key is configured or in env', () => {
    const r = resolveBrevo(cfg({ provider: 'brevo' }));
    expect(r.smsAvailable).toBe(false);
    expect(r.emailIsBrevo).toBe(true);
  });

  it('falls back to env for webhook secret and SMS sender', () => {
    process.env.BREVO_WEBHOOK_SECRET = 'env-secret';
    process.env.BREVO_SMS_SENDER = 'EnvSender';
    const r = resolveBrevo(cfg({ provider: 'brevo', brevoApiKey: 'k' }));
    expect(r.webhookSecret).toBe('env-secret');
    expect(r.smsSender).toBe('EnvSender');
  });
});
