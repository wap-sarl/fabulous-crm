/** The per-email OTP budget and Better Auth's per-IP limiter are not covered here: they need the full auth flow and are verified by hand. */
import { describe, expect, test } from 'bun:test';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

describe('consent route rate limits', () => {
  const post = (t: T, token: string) =>
    t.fetch(`/consent/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ types: {} }),
    });

  test('per-token limit: the 11th write in a minute is refused, another token unaffected', async () => {
    process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
    const { t } = await setup();
    await seedLead(t, { email: 'a@example.com', consentToken: 'token-aaaa' });
    await seedLead(t, { email: 'b@example.com', consentToken: 'token-bbbb' });

    for (let i = 0; i < 10; i++) expect((await post(t, 'token-aaaa')).status).toBe(200);
    const eleventh = await post(t, 'token-aaaa');
    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toEqual({ ok: false, code: 'rate_limited' });

    // The acceptance case: a legitimate second user is unaffected.
    expect((await post(t, 'token-bbbb')).status).toBe(200);
  });

  test('invalid tokens share a global bucket: enumeration gets rate_limited', async () => {
    process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
    const { t } = await setup();
    for (let i = 0; i < 30; i++) {
      const res = await post(t, `guess-${i}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, code: 'invalid_token' });
    }
    const overrun = await post(t, 'guess-final');
    expect(overrun.status).toBe(429);
    expect(await overrun.json()).toEqual({ ok: false, code: 'rate_limited' });
  });
});

describe('tracked-link route rate limit (per IP)', () => {
  test('the 61st hit from one IP gets 429; another IP is unaffected', async () => {
    const { t } = await setup();
    const hit = (ip: string) =>
      t.fetch('/l/some-token', { method: 'GET', headers: { 'x-forwarded-for': ip } });

    for (let i = 0; i < 60; i++) {
      expect((await hit('203.0.113.7')).status).toBe(404); // unknown token, not limited
    }
    expect((await hit('203.0.113.7')).status).toBe(429);
    expect((await hit('198.51.100.9')).status).toBe(404);
  });
});
