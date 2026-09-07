import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { EntitlementsPayload } from '../../convex/_lib/validators/entitlements';
import {
  _setPublicKeysForTests,
  ENTITLEMENTS_GRACE_MS,
  hasFeature,
  loadEntitlements,
} from '../../convex/lib/entitlements';
import {
  generateEntitlementsKeyPair,
  signEntitlements,
} from '../../scripts/lib/entitlementsSigner';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const ENV = ['EDITION', 'TENANT_ID', 'TENANT_STATUS', 'ENTITLEMENTS'] as const;
const pair = await generateEntitlementsKeyPair();
const stranger = await generateEntitlementsKeyPair();

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.TENANT_ID = 'acme';
  _setPublicKeysForTests([pair.publicJwk]);
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function payload(overrides: Partial<EntitlementsPayload> = {}): EntitlementsPayload {
  const now = Date.now();
  return {
    tenant: 'acme',
    plan: 'pro',
    seats: null,
    workflowRunsPerMonth: null,
    apiCallsPerMonth: null,
    retentionDays: { audit: null, events: null },
    features: ['webhooks'],
    iat: now,
    exp: now + 30 * DAY_MS,
    ...overrides,
  };
}

/** Sets ENTITLEMENTS to a token over `payload(overrides)` signed with `key`. */
async function grant(overrides: Partial<EntitlementsPayload> = {}, key = pair.privateJwk) {
  process.env.ENTITLEMENTS = await signEntitlements(key, payload(overrides));
}

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  return { t, as: asIdentity(t, emp.identity) };
}

const withKey = (t: ReturnType<typeof createTestConvex>, key: string, path = 'me') =>
  t.fetch(`/api/v1/${path}`, { method: 'GET', headers: { Authorization: `Bearer ${key}` } });

describe('entitlements', () => {
  test('no token means community edition, under EDITION=saas too', async () => {
    let state = await loadEntitlements();
    expect(state).toMatchObject({ edition: 'ce', source: 'ce', features: [], seats: null });
    expect(await hasFeature('webhooks')).toBe(false);

    process.env.EDITION = 'saas';
    state = await loadEntitlements();
    expect(state).toMatchObject({ edition: 'saas', source: 'ce', reason: null });
  });

  test('a valid token grants; forged, tampered, foreign and long-expired ones fall back', async () => {
    await grant();
    expect(await loadEntitlements()).toMatchObject({
      source: 'token',
      plan: 'pro',
      features: ['webhooks'],
      expiring: false,
    });
    expect(await hasFeature('webhooks')).toBe(true);

    await grant({}, stranger.privateJwk);
    expect(await loadEntitlements()).toMatchObject({ source: 'ce', reason: 'bad_signature' });

    // Same signature, edited payload.
    await grant({ plan: 'starter' });
    const [, signature] = (process.env.ENTITLEMENTS as string).split('.');
    const forged = btoa(JSON.stringify(payload({ plan: 'enterprise' })))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    process.env.ENTITLEMENTS = `${forged}.${signature}`;
    expect((await loadEntitlements()).reason).toBe('bad_signature');

    process.env.ENTITLEMENTS = 'not-a-token';
    expect((await loadEntitlements()).reason).toBe('malformed_token');

    await grant({ tenant: 'someone-else' });
    expect((await loadEntitlements()).reason).toBe('tenant_mismatch');

    await grant({ exp: Date.now() - ENTITLEMENTS_GRACE_MS - 1000 });
    expect(await loadEntitlements()).toMatchObject({ source: 'ce', reason: 'expired' });
  });

  test('an expired token keeps granting during the grace period and is flagged', async () => {
    await grant({ exp: Date.now() - 1000 });
    expect(await loadEntitlements()).toMatchObject({ source: 'token', expiring: true });
    await grant({ exp: Date.now() + ENTITLEMENTS_GRACE_MS - 1000 });
    expect((await loadEntitlements()).expiring).toBe(true);
  });

  test('any embedded key verifies, so two can overlap during a rotation', async () => {
    _setPublicKeysForTests([stranger.publicJwk, pair.publicJwk]);
    await grant();
    expect((await loadEntitlements()).source).toBe('token');
    _setPublicKeysForTests([stranger.publicJwk]);
    expect((await loadEntitlements()).reason).toBe('bad_signature');
  });

  test('getEntitlements exposes the state and the seats in use, never the token', async () => {
    const { as } = await setup();
    await grant({ seats: 5 });
    const state = await as.query(api.features.config.queries.getEntitlements, {});
    expect(state).toMatchObject({ source: 'token', seats: 5, seatsUsed: 1 });
    expect(JSON.stringify(state)).not.toContain(process.env.ENTITLEMENTS as string);
  });

  test('a suspended tenant refuses employees, answers 402 on the API and says so publicly', async () => {
    const { t, as } = await setup();
    const { key } = await as.mutation(api.features.api.mutations.createApiKey, {
      name: 'k',
      scopes: ['contacts:read'],
    });
    expect((await withKey(t, key)).status).toBe(200);

    process.env.TENANT_STATUS = 'suspended';
    expect(await t.query(api.features.config.queries.getPublicConfig, {})).toMatchObject({
      tenantStatus: 'suspended',
    });
    await expect(as.query(api.features.config.queries.getLifecycleConfig, {})).rejects.toThrow(
      /tenant_suspended/,
    );
    const refused = await withKey(t, key);
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'tenant_suspended',
    );
    // Strangers still get the generic 401: suspension is not disclosed to them.
    expect((await t.fetch('/api/v1/me', { method: 'GET' })).status).toBe(401);
  });

  test('seats: pending invitations count, and the N+1 one is refused', async () => {
    const { as } = await setup();
    await grant({ seats: 2 });
    const invite = (email: string) =>
      as.mutation(api.features.invitations.mutations.createInvitation, { email, role: 'member' });
    await invite('one@example.com');
    await expect(invite('two@example.com')).rejects.toThrow(/seat_limit_reached/);

    await grant({ seats: null });
    await invite('two@example.com');
  });

  test('workflow runs stop at the monthly quota without breaking the lead write', async () => {
    const { t, as } = await setup();
    await grant({ workflowRunsPerMonth: 1 });
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Bienvenue',
      trigger: { type: 'lead_created' },
      allowReEnrollment: false,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    for (const n of [1, 2, 3]) {
      await as.mutation(api.features.crm.mutations.createLead, {
        firstName: `L${n}`,
        lastName: 'Quota',
        email: `l${n}@example.com`,
      });
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query('workflowRuns').collect()).toHaveLength(1);
      expect(await ctx.db.query('leads').collect()).toHaveLength(3);
      expect(await ctx.db.query('usageCounters').collect()).toMatchObject([
        { kind: 'workflowRuns', subject: '', count: 1 },
      ]);
    });
  });

  test('API calls stop at the monthly quota with 402; unlimited plans are not counted', async () => {
    const { t, as } = await setup();
    const { key } = await as.mutation(api.features.api.mutations.createApiKey, {
      name: 'k',
      scopes: ['contacts:read'],
    });
    await grant({ apiCallsPerMonth: 2 });
    expect((await withKey(t, key)).status).toBe(200);
    expect((await withKey(t, key)).status).toBe(200);
    const refused = await withKey(t, key);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({
      error: { code: 'quota_exceeded', details: { limit: 2, used: 2 } },
    });

    await grant({ apiCallsPerMonth: null });
    expect((await withKey(t, key)).status).toBe(200);
    const rows = await t.run((ctx) => ctx.db.query('usageCounters').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });
});
