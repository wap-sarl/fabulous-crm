import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

/**
 * Public consent surface: `updateConsentByToken` is deliberately unauthenticated
 * (the token is the secret) and the ONLY writer of marketingConsent — employee
 * mutations must not accept it.
 */
describe('updateConsentByToken', () => {
  test('a valid token sets the channels, source, and timestamp', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'agent@example.com' });
    const leadId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createLead,
      {
        firstName: 'Lea',
        lastName: 'Durand',
        email: 'lea@example.com',
      },
    );
    const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken;
    if (!token) throw new Error('lead has no consent token');

    // No identity: the public consent page is unauthenticated by design.
    const result = await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token,
      channels: ['email', 'sms', 'email'],
    });
    expect(result).toEqual({ success: true });

    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.marketingConsent?.sort()).toEqual(['email', 'sms']); // deduplicated
    expect(lead?.consentSource).toBe('public_link');
    expect(lead?.consentUpdatedAt).toBeGreaterThan(0);
  });

  test('an unknown token is rejected without writing anything', async () => {
    const t = createTestConvex();
    const result = await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token: 'deadbeefdeadbeefdeadbeefdeadbeef',
      channels: ['email'],
    });
    expect(result).toEqual({ success: false, error: 'invalid_token' });
  });

  test('a soft-deleted lead token behaves like an invalid token', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'agent@example.com' });
    const as = asIdentity(t, emp.identity);
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Gone',
      lastName: 'Lead',
      email: 'gone@example.com',
    });
    const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken;
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId });

    const result = await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token: token ?? '',
      channels: ['email'],
    });
    expect(result).toEqual({ success: false, error: 'invalid_token' });
  });

  test('revoking all channels leaves an empty consent array', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'agent@example.com' });
    const leadId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createLead,
      {
        firstName: 'Optout',
        lastName: 'Lead',
        email: 'optout@example.com',
      },
    );
    const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken ?? '';
    await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token,
      channels: ['email'],
    });
    await t.mutation(api.features.crm.mutations.updateConsentByToken, { token, channels: [] });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.marketingConsent).toEqual([]);
  });
});
