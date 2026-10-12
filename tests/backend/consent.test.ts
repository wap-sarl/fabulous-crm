import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

/** The preference centre writes through `POST /consent/<token>`, unauthenticated on purpose (the token is the secret) and the only writer of a contact's consent: employee mutations must not accept it. */
describe('POST /consent/<token>', () => {
  async function setup() {
    process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
    const as = asIdentity(t, emp.identity);
    await as.mutation(api.features.subscriptions.mutations.ensureDefaults, {});
    const [type] = await as.query(api.features.subscriptions.queries.listSubscriptionTypes, {});
    const leadId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Lea',
      lastName: 'Durand',
      email: 'lea@example.com',
    });
    const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken ?? '';
    return { t, as, type, leadId, token };
  }
  const post = (t: ReturnType<typeof createTestConvex>, token: string, body: unknown) =>
    t.fetch(`/consent/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('a valid token saves the choice, its source and its time, and the channel the type needs', async () => {
    const { t, type, leadId, token } = await setup();
    const response = await post(t, token, { types: { [type._id]: true } });
    expect(response.status).toBe(200);
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.marketingConsent).toEqual(['email']);
    expect(lead?.subscriptions).toMatchObject([{ typeId: type._id, status: 'in' }]);
    expect(lead?.consentSource).toBe('preference_center');
    expect(lead?.consentUpdatedAt).toBeGreaterThan(0);
  });

  test('an unknown token is refused without writing anything', async () => {
    const { t } = await setup();
    const response = await post(t, 'deadbeefdeadbeefdeadbeefdeadbeef', { unsubscribeAll: true });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, code: 'invalid_token' });
    expect(await t.run((ctx) => ctx.db.query('consentEvents').collect())).toEqual([]);
  });

  test('a soft-deleted lead token behaves like an invalid token', async () => {
    const { t, as, leadId, token } = await setup();
    await as.mutation(api.features.leads.mutations.deleteLead, { leadId });
    expect((await post(t, token, { unsubscribeAll: true })).status).toBe(404);
  });

  test('« tout désinscrire » leaves an empty consent array', async () => {
    const { t, type, leadId, token } = await setup();
    await post(t, token, { types: { [type._id]: true } });
    await post(t, token, { unsubscribeAll: true });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.marketingConsent).toEqual([]);
    expect(lead?.subscriptions?.map((s) => s.status)).toEqual(['out', 'out', 'out']);
  });
});
