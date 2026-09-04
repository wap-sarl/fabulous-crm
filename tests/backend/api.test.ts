import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { ApiScope } from '../../convex/_lib/validators/apiKeys';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

const ALL_READ_SCOPES: ApiScope[] = [
  'contacts:read',
  'companies:read',
  'deals:read',
  'activities:read',
  'lists:read',
  'properties:read',
];

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

type As = ReturnType<typeof asIdentity>;

function createKey(as: As, scopes: ApiScope[] = ALL_READ_SCOPES, expiresAt?: number) {
  return as.mutation(api.features.api.mutations.createApiKey, {
    name: 'Test key',
    scopes,
    expiresAt,
  });
}

const apiGet = (t: T, path: string, key?: string) =>
  t.fetch(`/api/v1/${path}`, {
    method: 'GET',
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });

describe('public REST API', () => {
  test('every auth failure mode yields the same generic 401', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as);

    const revoked = await createKey(as);
    const revokedRow = (await as.query(api.features.api.queries.listApiKeys, {})).find(
      (k) => k._id === revoked.id,
    );
    expect(revokedRow).toBeDefined();
    await as.mutation(api.features.api.mutations.revokeApiKey, { id: revoked.id });
    const expired = await createKey(as, ALL_READ_SCOPES, Date.now() + 60_000);

    const failures = [
      await apiGet(t, 'me'), // no header
      await apiGet(t, 'me', 'not-a-key'), // malformed
      await apiGet(t, 'me', `wap_${'0'.repeat(8)}_${'0'.repeat(48)}`), // unknown keyId
      await apiGet(t, 'me', `${key.slice(0, -4)}0000`), // wrong secret
      await apiGet(t, 'me', revoked.key), // revoked
    ];
    for (const res of failures) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: 'unauthorized', message: 'Invalid API key.' },
      });
    }

    // An expired key fails identically once its expiry passes.
    const originalNow = Date.now;
    Date.now = () => originalNow() + 120_000;
    try {
      expect((await apiGet(t, 'me', expired.key)).status).toBe(401);
    } finally {
      Date.now = originalNow;
    }

    // The valid key introduces itself on /me.
    const me = await apiGet(t, 'me', key);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: 'Test key', scopes: ALL_READ_SCOPES });
  });

  test('scopes gate each resource; management listing never leaks the hash', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ['companies:read']);

    const refused = await apiGet(t, 'contacts', key);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'missing_scope',
    );
    expect((await apiGet(t, 'companies', key)).status).toBe(200);

    const rows = await as.query(api.features.api.queries.listApiKeys, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('secretHash');
    expect(rows[0].keyId).toMatch(/^[0-9a-f]{8}$/);
  });

  test('contacts: list, email filter, pagination, and the DTO allowlist', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as);
    const deletedId = await seedLead(t, { email: 'gone@example.com', deletedAt: Date.now() });
    for (let i = 0; i < 3; i++) {
      await seedLead(t, { firstName: `Lead${i}`, email: `lead${i}@example.com` });
    }

    const first = await apiGet(t, 'contacts?limit=2', key);
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as { data: Record<string, unknown>[]; nextCursor: string };
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    // The allowlist mapper: public fields in, internals out.
    expect(page1.data[0]).toHaveProperty('id');
    expect(page1.data[0]).toHaveProperty('createdAt');
    expect(page1.data[0]).not.toHaveProperty('consentToken');
    expect(page1.data[0]).not.toHaveProperty('searchText');
    expect(page1.data[0]).not.toHaveProperty('dedupe');
    expect(page1.data[0]).not.toHaveProperty('scoreBreakdown');
    expect(page1.data[0]).not.toHaveProperty('_id');

    const rest = await apiGet(t, `contacts?cursor=${encodeURIComponent(page1.nextCursor)}`, key);
    const page2 = (await rest.json()) as { data: { email: string }[]; nextCursor: string | null };
    // 4 leads seeded, one soft-deleted: 2 + 1 across the two pages.
    expect(page1.data.length + page2.data.length).toBe(3);
    expect([...page1.data, ...page2.data].map((c) => c.email)).not.toContain('gone@example.com');

    const filtered = await apiGet(t, 'contacts?email=LEAD1%40example.com', key);
    const byEmail = (await filtered.json()) as { data: { email: string }[] };
    expect(byEmail.data).toHaveLength(1);
    expect(byEmail.data[0].email).toBe('lead1@example.com');

    expect((await apiGet(t, `contacts/${deletedId}`, key)).status).toBe(404);
    expect((await apiGet(t, 'contacts/notanid', key)).status).toBe(404);
    expect((await apiGet(t, 'contacts?limit=101', key)).status).toBe(400);
    expect((await apiGet(t, 'contacts?limit=0', key)).status).toBe(400);
  });

  test('companies, deals and activities read with their filters', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as);
    const now = Date.now();
    const { companyId, leadId, dealId, activityId } = await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', {
        name: 'Acme',
        country: 'FR',
        domain: 'acme.fr',
        ownerIds: [],
        updatedAt: now,
      });
      const pipelineId = await ctx.db.insert('pipelines', {
        name: 'Ventes',
        stages: [
          { key: 'new', label: 'Nouveau', kind: 'open' },
          { key: 'won', label: 'Gagné', kind: 'won' },
        ],
        updatedAt: now,
      });
      const dealId = await ctx.db.insert('deals', {
        title: 'Gros contrat',
        currency: 'EUR',
        pipelineId,
        stageKey: 'new',
        status: 'open',
        ownerIds: [],
        updatedAt: now,
      });
      const activityId = await ctx.db.insert('activities', {
        type: 'call',
        title: 'Appel de suivi',
        status: 'open',
        updatedAt: now,
      });
      return { companyId, dealId, activityId, leadId: null as Id<'leads'> | null };
    });
    const lead = await seedLead(t, { email: 'contact@acme.fr', companyId });
    await t.run(async (ctx) => {
      await ctx.db.patch(dealId, { leadId: lead });
      await ctx.db.patch(activityId, { leadId: lead });
    });
    void leadId;

    const companies = await apiGet(t, 'companies?domain=acme.fr', key);
    const companyList = (await companies.json()) as { data: { id: string; name: string }[] };
    expect(companyList.data).toHaveLength(1);
    expect(companyList.data[0].name).toBe('Acme');
    expect((await apiGet(t, `companies/${companyId}`, key)).status).toBe(200);

    const deals = await apiGet(t, `deals?leadId=${lead}`, key);
    const dealList = (await deals.json()) as { data: { title: string; stageKey: string }[] };
    expect(dealList.data).toHaveLength(1);
    expect(dealList.data[0]).toMatchObject({ title: 'Gros contrat', stageKey: 'new' });
    expect((await apiGet(t, `deals/${dealId}`, key)).status).toBe(200);

    const activities = await apiGet(t, `activities?leadId=${lead}`, key);
    const activityList = (await activities.json()) as { data: { title: string }[] };
    expect(activityList.data).toHaveLength(1);
    expect((await apiGet(t, `activities/${activityId}`, key)).status).toBe(200);
  });

  test('lists, list members and property definitions are readable', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as);
    const leadId = await seedLead(t, { email: 'member@example.com' });
    const listId = await t.run(async (ctx) => {
      const listId = await ctx.db.insert('leadLists', { name: 'Import Q1', updatedAt: Date.now() });
      await ctx.db.insert('leadListMembers', { listId, leadId });
      return listId;
    });
    await as.mutation(api.features.properties.mutations.createDefinition, {
      entityType: 'lead',
      label: 'Spécialité',
      type: 'text',
      showInTable: false,
    });

    const lists = await apiGet(t, 'lists', key);
    const listList = (await lists.json()) as { data: { id: string; kind: string }[] };
    expect(listList.data).toHaveLength(1);
    expect(listList.data[0].kind).toBe('static');

    const members = await apiGet(t, `lists/${listId}/members`, key);
    const memberList = (await members.json()) as { data: { email: string }[] };
    expect(memberList.data).toHaveLength(1);
    expect(memberList.data[0].email).toBe('member@example.com');
    expect((await apiGet(t, 'lists/notalist/members', key)).status).toBe(404);

    const props = await apiGet(t, 'properties?entityType=lead', key);
    const propList = (await props.json()) as { data: { label: string; type: string }[] };
    expect(propList.data).toHaveLength(1);
    expect(propList.data[0]).toMatchObject({ label: 'Spécialité', type: 'text' });
    expect((await apiGet(t, 'properties?entityType=nope', key)).status).toBe(400);
    expect((await apiGet(t, 'properties', key)).status).toBe(400);

    expect((await apiGet(t, 'unknown', key)).status).toBe(404);
  });

  test('failed auth attempts are rate-limited per IP', async () => {
    const { t } = await setup();
    for (let i = 0; i < 10; i++) {
      expect((await apiGet(t, 'me', 'bad')).status).toBe(401);
    }
    const limited = await apiGet(t, 'me', 'bad');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  test('authenticated traffic consumes the per-key budget', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as);
    for (let i = 0; i < 120; i++) {
      expect((await apiGet(t, 'me', key)).status).toBe(200);
    }
    const limited = await apiGet(t, 'me', key);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  test('key management is audited and revocation cuts access', async () => {
    const { t, as } = await setup();
    const { id, key } = await createKey(as, ['contacts:read']);
    expect((await apiGet(t, 'me', key)).status).toBe(200);

    await as.mutation(api.features.api.mutations.updateApiKey, {
      id,
      name: 'Renamed',
      scopes: ['contacts:read', 'lists:read'],
    });
    await as.mutation(api.features.api.mutations.revokeApiKey, { id });
    expect((await apiGet(t, 'me', key)).status).toBe(401);

    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter((a) => a.entityType === 'apiKey'),
    );
    expect(audits.map((a) => a.action).sort()).toEqual(['create', 'update', 'update']);
    // The audit trail carries the public keyId, never the secret or its hash.
    expect(JSON.stringify(audits)).not.toContain(key.split('_')[2]);
  });
});
