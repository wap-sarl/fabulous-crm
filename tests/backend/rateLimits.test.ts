/**
 * Rate limiting on the public surfaces (#17): per-token consent updates, the
 * global invalid-token enumeration guard, and the per-IP tracked-link route.
 * (The per-email OTP budget and Better Auth's per-IP limiter ride the same
 * component but need the full auth flow — covered by manual verification.)
 */
import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, seedEmployee, seedLead } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

describe('consent rate limits', () => {
  test('per-token limit: the 11th update in a minute is refused, another token unaffected', async () => {
    const { t } = await setup();
    const leadA = await seedLead(t, { email: 'a@example.com', consentToken: 'token-aaaa' });
    const leadB = await seedLead(t, { email: 'b@example.com', consentToken: 'token-bbbb' });
    void leadA;
    void leadB;

    for (let i = 0; i < 10; i++) {
      const res = await t.mutation(api.features.crm.mutations.updateConsentByToken, {
        token: 'token-aaaa',
        channels: i % 2 === 0 ? ['email'] : [],
      });
      expect(res.success).toBe(true);
    }
    const eleventh = await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token: 'token-aaaa',
      channels: ['email'],
    });
    expect(eleventh).toEqual({ success: false, error: 'rate_limited' });

    // The acceptance case: a legitimate second user is unaffected.
    const other = await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token: 'token-bbbb',
      channels: ['email'],
    });
    expect(other.success).toBe(true);
  });

  test('invalid tokens share a global bucket: enumeration gets rate_limited', async () => {
    const { t } = await setup();
    for (let i = 0; i < 30; i++) {
      const res = await t.mutation(api.features.crm.mutations.updateConsentByToken, {
        token: `guess-${i}`,
        channels: [],
      });
      expect(res).toEqual({ success: false, error: 'invalid_token' });
    }
    const overrun = await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token: 'guess-final',
      channels: [],
    });
    expect(overrun).toEqual({ success: false, error: 'rate_limited' });
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
