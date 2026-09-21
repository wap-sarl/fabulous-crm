import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ConvexError } from 'convex/values';
import { setExtensionsForTests } from '../../convex/extensions';
import { describeSignInError, emailCodeForm } from '../../src/lib/errors';
import { extensions as frontend } from '../../src/extensions';
import { createTestConvex, seedEmployee, type T } from './helpers';

const ENV = ['SITE_URL', 'CONVEX_SITE_URL', 'BETTER_AUTH_SECRET', 'DEV_WHITELIST_EMAILS'] as const;
let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
/** Every request the deployment made to the e-mail provider, and how long the provider takes to answer. */
let mails: string[] = [];
let providerDelayMs = 0;
const opened: T[] = [];
/** An address no other test file uses. */
const RECIPIENT = 'ada.sign-in-seam@example.com';
/** The delivery is scheduled: let it run to its end. */
const delivered = async (t: T) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await t.finishInProgressScheduledFunctions();
};
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.SITE_URL = 'https://crm.example.com';
  process.env.CONVEX_SITE_URL = 'https://crm-123.convex.site';
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret-test-auth-secret';
  delete process.env.DEV_WHITELIST_EMAILS;
  const mine: string[] = [];
  mails = mine;
  providerDelayMs = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    // Another file's background work must neither be counted nor reach the network: only our recipient's mail is ours.
    const ours = url.includes('brevo.com') && String(init?.body ?? '').includes(RECIPIENT);
    if (!ours) return new Response(null, { status: 503 });
    if (providerDelayMs) await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
    mine.push(url);
    return new Response(JSON.stringify({ messageId: 'm1' }), { status: 201 });
  }) as typeof fetch;
});
afterEach(async () => {
  // No delivery may outlive its test and land in another file's mock.
  for (const t of opened.splice(0)) await delivered(t);
  setExtensionsForTests(null);
  frontend.describeRefusal = undefined;
  frontend.loginMethods = undefined;
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function setup() {
  const t = createTestConvex();
  opened.push(t);
  await seedEmployee(t, { email: RECIPIENT, role: 'member' });
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'Test',
      appUrl: 'https://crm.example.com',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      email: { provider: 'brevo', brevoApiKey: 'xkeysib-test' },
      updatedAt: Date.now(),
    }),
  );
  return t;
}
const requestCode = (t: T, email: string) =>
  t.fetch('/api/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://crm.example.com' },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });

/** Runs `fn` with console.warn captured, restored whatever happens. */
async function capturingWarnings(fn: () => Promise<void>): Promise<string> {
  const warn = console.warn;
  const lines: string[] = [];
  console.warn = (...parts: unknown[]) => void lines.push(parts.join(' '));
  try {
    await fn();
  } finally {
    console.warn = warn;
  }
  return lines.join('\n');
}

describe('sign-in seam', () => {
  test('beforeSignInCode sees the normalised e-mail and why the code goes out; by default it goes out', async () => {
    const t = await setup();
    const seen: unknown[] = [];
    setExtensionsForTests({
      beforeSignInCode: async (_ctx, info) => {
        seen.push(info);
      },
    });
    expect((await requestCode(t, RECIPIENT.toUpperCase())).status).toBe(200);
    await delivered(t);
    expect(seen).toEqual([{ email: RECIPIENT, type: 'sign-in' }]);
    expect(mails).toHaveLength(1);
  });

  test('a refusal sends nothing, and the requester is told nothing: same answer as a code that went out', async () => {
    const t = await setup();
    const sent = await requestCode(t, RECIPIENT);
    await delivered(t);
    expect(mails).toHaveLength(1);
    setExtensionsForTests({
      beforeSignInCode: async () => {
        throw new ConvexError({ code: 'sign_in_code_refused' });
      },
    });
    let refused: Response | undefined;
    const warned = await capturingWarnings(async () => {
      refused = await requestCode(t, RECIPIENT);
      await delivered(t);
    });
    expect(mails).toHaveLength(1);
    expect(refused!.status).toBe(sent.status);
    expect(await refused!.json()).toEqual(await sent.json());
    expect(warned).toContain('sign_in_code_refused');
    expect(warned).not.toContain(RECIPIENT);
  });

  test('the log is the core’s to keep clean: a plain error, or a code carrying the address, is logged as unknown', async () => {
    const t = await setup();
    for (const refusal of [
      new Error(`refused for ${RECIPIENT}`),
      new ConvexError({ code: `refused for ${RECIPIENT}` }),
      new ConvexError(RECIPIENT),
    ]) {
      setExtensionsForTests({
        beforeSignInCode: async () => {
          throw refusal;
        },
      });
      const warned = await capturingWarnings(async () => {
        await requestCode(t, RECIPIENT);
        await delivered(t);
      });
      expect(warned).toContain('refused by the extension seam: unknown');
      expect(warned).not.toContain(RECIPIENT);
    }
    expect(mails).toEqual([]);
  });

  test('the request never waits for the decision nor for the provider, so its duration says nothing about the address', async () => {
    const t = await setup();
    providerDelayMs = 400;
    const timed = async () => {
      const start = performance.now();
      await requestCode(t, RECIPIENT);
      return performance.now() - start;
    };
    const accepted = await timed();
    // The request is back and nothing went out yet: the delivery runs on its own, then the mail leaves.
    expect(mails).toEqual([]);
    await delivered(t);
    expect(mails).toHaveLength(1);
    setExtensionsForTests({
      beforeSignInCode: async () => {
        throw new ConvexError({ code: 'sign_in_code_refused' });
      },
    });
    const refused = await capturingWarnings(async () => {
      expect(await timed()).toBeLessThan(providerDelayMs / 2);
      await delivered(t);
    });
    // Both answered before the provider could have: neither branch is in the request's path.
    expect(accepted).toBeLessThan(providerDelayMs / 2);
    expect(refused).toContain('sign_in_code_refused');
    await delivered(t);
    expect(mails).toHaveLength(1);
  });

  test('the hook is not asked when the deployment turned the method off', async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const config = await ctx.db.query('appConfig').first();
      await ctx.db.patch(config!._id, { auth: { magicLinkEnabled: false } });
    });
    let asked = 0;
    setExtensionsForTests({
      beforeSignInCode: async () => {
        asked += 1;
      },
    });
    await requestCode(t, RECIPIENT);
    await delivered(t);
    expect(asked).toBe(0);
    expect(mails).toEqual([]);
  });
});

describe('login page seam', () => {
  const config = { auth: { magicLink: true }, requireProvider: true };

  test('loginMethods can take the e-mail code form away or put a notice on it, never bring back a method the deployment disabled', () => {
    const none = new URLSearchParams();
    expect(emailCodeForm(config, none)).toEqual({ shown: true, notice: null });
    // Without an overlay the form is there while the config loads, as before.
    expect(emailCodeForm(undefined, none)).toEqual({ shown: true, notice: null });
    frontend.loginMethods = (publicConfig, search) =>
      publicConfig.requireProvider && !search.has('code')
        ? { emailCode: false, emailCodeNotice: 'never shown' }
        : { emailCodeNotice: 'Réservé aux administrateurs.' };
    expect(emailCodeForm(config, none)).toEqual({ shown: false, notice: null });
    expect(emailCodeForm(config, new URLSearchParams('code'))).toEqual({
      shown: true,
      notice: 'Réservé aux administrateurs.',
    });
    // With one, nothing is decided until the config arrives: no form that vanishes a moment later.
    expect(emailCodeForm(undefined, new URLSearchParams('code'))).toEqual({
      shown: false,
      notice: null,
    });
    frontend.loginMethods = () => ({ emailCode: true });
    expect(emailCodeForm({ auth: { magicLink: false } }, none).shown).toBe(false);
  });

  test('a sign-in error is described by the overlay first, by the core otherwise', () => {
    expect(describeSignInError({ code: 'FORBIDDEN', message: 'not_invited' })).toMatch(
      /pas autorisée/,
    );
    expect(describeSignInError({ code: 'INVALID_OTP' })).toMatch(/Code incorrect/);
    expect(describeSignInError(null)).toMatch(/Une erreur est survenue/);
    frontend.describeRefusal = ({ code }) =>
      code === 'sign_in_code_refused' ? 'Utilisez la connexion de votre organisation.' : null;
    expect(describeSignInError({ code: 'FORBIDDEN', message: 'sign_in_code_refused' })).toBe(
      'Utilisez la connexion de votre organisation.',
    );
    expect(describeSignInError({ code: 'FORBIDDEN', message: 'not_invited' })).toMatch(
      /pas autorisée/,
    );
  });
});
