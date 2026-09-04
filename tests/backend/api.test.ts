import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { API_SCOPES, type ApiScope } from '../../convex/_lib/validators/apiKeys';
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

const apiCall = (
  t: T,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  key: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  t.fetch(`/api/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Run with Date.now pinned, so rate-limit buckets cannot refill mid-test. */
async function frozenNow<R>(fn: () => Promise<R>): Promise<R> {
  const real = Date.now;
  const now = real();
  Date.now = () => now;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };
const errorCode = async (res: Response) => ((await res.json()) as ErrorBody).error.code;

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
    // Frozen clock: the token bucket must not refill while the loop runs.
    await frozenNow(async () => {
      for (let i = 0; i < 600; i++) {
        expect((await apiGet(t, 'me', key)).status).toBe(200);
      }
      const limited = await apiGet(t, 'me', key);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    });
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

describe('public REST API writes', () => {
  const ALL_SCOPES = [...API_SCOPES];

  async function seedPipeline(t: T, stages: { key: string; kind: 'open' | 'won' | 'lost' }[]) {
    return await t.run(async (ctx) =>
      ctx.db.insert('pipelines', {
        name: 'Ventes',
        stages: stages.map((s) => ({ ...s, label: s.key })),
        isDefault: true,
        updatedAt: Date.now(),
      }),
    );
  }

  test('POST /contacts creates with the api lifecycle source, audit and workflow enrollment', async () => {
    const { t, as, emp } = await setup();
    const { id: keyId, key } = await createKey(as, ALL_SCOPES);
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
    const propId = await as.mutation(api.features.properties.mutations.createDefinition, {
      entityType: 'lead',
      label: 'Spécialité',
      type: 'text',
      showInTable: false,
    });

    const res = await apiCall(t, 'POST', 'contacts', key, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'Ada@Example.com',
      ownerIds: [emp.userId],
      customProperties: { [propId]: 'Cardiologie' },
    });
    expect(res.status).toBe(201);
    const contact = (await res.json()) as Record<string, unknown>;
    expect(contact).toMatchObject({
      firstName: 'Ada',
      email: 'ada@example.com',
      ownerIds: [emp.userId],
      customProperties: { [propId]: 'Cardiologie' },
    });
    expect(contact).not.toHaveProperty('consentToken');

    const leadId = contact.id as Id<'leads'>;
    await t.run(async (ctx) => {
      const history = await ctx.db
        .query('lifecycleStageHistory')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .collect();
      expect(history.map((h) => h.source)).toEqual(['api']);
      const audits = (await ctx.db.query('auditLogs').collect()).filter(
        (a) => a.entityType === 'lead' && a.entityId === leadId,
      );
      expect(audits).toHaveLength(1);
      expect(audits[0].apiKeyId).toBe(keyId);
      expect(audits[0].userId).toBeUndefined();
      const runs = await ctx.db
        .query('workflowRuns')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .collect();
      expect(runs).toHaveLength(1);
      // The trigger wrapper ran: the lead carries its search text.
      expect((await ctx.db.get(leadId))?.searchText).toContain('ada');
    });

    // Strict create: the same email is a conflict pointing at the existing contact.
    const dup = await apiCall(t, 'POST', 'contacts', key, { email: 'ada@example.com' });
    expect(dup.status).toBe(409);
    const dupBody = (await dup.json()) as ErrorBody;
    expect(dupBody.error.code).toBe('duplicate_email');
    expect(dupBody.error.details?.existingId).toBe(leadId);
  });

  test('write validation: read-only consent, unknown fields and properties, bad ids, scopes', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ALL_SCOPES);
    const { key: readOnly } = await createKey(as, ['contacts:read']);
    const { key: writeOnly } = await createKey(as, ['contacts:write']);

    const consent = await apiCall(t, 'POST', 'contacts', key, { marketingConsent: ['email'] });
    expect(consent.status).toBe(400);
    expect(await errorCode(consent)).toBe('read_only_field');

    const unknownField = await apiCall(t, 'POST', 'contacts', key, { nickname: 'x' });
    expect(unknownField.status).toBe(400);
    expect(await errorCode(unknownField)).toBe('invalid_fields');

    const badType = await apiCall(t, 'POST', 'contacts', key, { firstName: 3 });
    expect(await errorCode(badType)).toBe('invalid_fields');

    const unknownProp = await apiCall(t, 'POST', 'contacts', key, {
      customProperties: { nope: 'x' },
    });
    expect(await errorCode(unknownProp)).toBe('unknown_property');

    const badOwner = await apiCall(t, 'POST', 'contacts', key, { ownerIds: ['notanid'] });
    expect(await errorCode(badOwner)).toBe('invalid_fields');

    const badStage = await apiCall(t, 'POST', 'contacts', key, { lifecycleStage: 'nope' });
    expect(badStage.status).toBe(400);
    expect(await errorCode(badStage)).toBe('unknown_lifecycle_stage');

    const notJson = await apiCall(t, 'POST', 'contacts', key, '{not json');
    expect(await errorCode(notJson)).toBe('invalid_json');

    expect((await apiCall(t, 'POST', 'contacts', readOnly, {})).status).toBe(403);
    expect((await apiGet(t, 'contacts', writeOnly)).status).toBe(403);
    expect((await apiGet(t, 'contacts?cursor=garbage', key)).status).toBe(400);
    expect(await errorCode(await apiGet(t, 'contacts?cursor=garbage', key))).toBe('invalid_cursor');
  });

  test('POST /contacts/upsert creates, then merges with the import rules and revives', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ALL_SCOPES);
    const propId = await as.mutation(api.features.properties.mutations.createDefinition, {
      entityType: 'lead',
      label: 'Ville',
      type: 'text',
      showInTable: false,
    });
    const propId2 = await as.mutation(api.features.properties.mutations.createDefinition, {
      entityType: 'lead',
      label: 'Service',
      type: 'text',
      showInTable: false,
    });

    const noEmail = await apiCall(t, 'POST', 'contacts/upsert', key, { firstName: 'X' });
    expect(await errorCode(noEmail)).toBe('email_required');

    const first = await apiCall(t, 'POST', 'contacts/upsert', key, {
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      phone: '+33600000000',
      customProperties: { [propId]: 'Paris' },
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { created: boolean; data: { id: Id<'leads'> } };
    expect(created.created).toBe(true);

    // Promote through the UI so the merge can prove it leaves the stage alone.
    await as.mutation(api.features.crm.mutations.updateLead, {
      leadId: created.data.id,
      lifecycleStage: 'lead',
    });

    const second = await apiCall(t, 'POST', 'contacts/upsert', key, {
      email: 'GRACE@example.com',
      lastName: 'Hopper-Murray',
      lifecycleStage: 'subscriber',
      customProperties: { [propId2]: 'Marine' },
    });
    expect(second.status).toBe(200);
    const merged = (await second.json()) as {
      created: boolean;
      data: Record<string, unknown>;
    };
    expect(merged.created).toBe(false);
    expect(merged.data.id).toBe(created.data.id);
    expect(merged.data).toMatchObject({
      firstName: 'Grace',
      lastName: 'Hopper-Murray',
      phone: '+33600000000',
      lifecycleStage: 'lead',
      customProperties: { [propId]: 'Paris', [propId2]: 'Marine' },
    });

    // A soft-deleted match is revived rather than duplicated.
    expect((await apiCall(t, 'DELETE', `contacts/${created.data.id}`, key)).status).toBe(204);
    expect((await apiGet(t, `contacts/${created.data.id}`, key)).status).toBe(404);
    const revived = await apiCall(t, 'POST', 'contacts/upsert', key, {
      email: 'grace@example.com',
    });
    expect(revived.status).toBe(200);
    expect(((await revived.json()) as { data: { id: string } }).data.id).toBe(created.data.id);
    expect((await apiGet(t, `contacts/${created.data.id}`, key)).status).toBe(200);
  });

  test('PATCH and DELETE /contacts: partial update, clears, email conflict, 404 after delete', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ALL_SCOPES);
    const other = await seedLead(t, { email: 'taken@example.com' });
    const created = await apiCall(t, 'POST', 'contacts', key, {
      firstName: 'Linus',
      lastName: 'T',
      email: 'linus@example.com',
      phone: '+33611111111',
      comment: 'first',
    });
    const { id } = (await created.json()) as { id: string };

    const patched = await apiCall(t, 'PATCH', `contacts/${id}`, key, {
      lastName: 'Torvalds',
      phone: null,
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      firstName: 'Linus',
      lastName: 'Torvalds',
      phone: null,
      comment: 'first',
    });

    const conflict = await apiCall(t, 'PATCH', `contacts/${id}`, key, {
      email: 'taken@example.com',
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as ErrorBody).error.details?.existingId).toBe(other);

    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter((a) => a.entityId === id),
    );
    expect(audits.map((a) => a.action)).toEqual(['create', 'update']);
    expect((audits[1].metadata as { changes: Record<string, unknown> }).changes).toHaveProperty(
      'lastName',
    );

    expect((await apiCall(t, 'DELETE', `contacts/${id}`, key)).status).toBe(204);
    expect((await apiCall(t, 'DELETE', `contacts/${id}`, key)).status).toBe(404);
    expect((await apiCall(t, 'PATCH', `contacts/${id}`, key, { comment: 'x' })).status).toBe(404);
    expect((await apiCall(t, 'PATCH', 'contacts/notanid', key, {})).status).toBe(404);
  });

  test('companies: create, domain auto-attach on contacts, uniqueness, patch, delete', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ALL_SCOPES);
    const created = await apiCall(t, 'POST', 'companies', key, {
      name: 'Acme',
      domain: 'https://www.acme.fr/',
      website: ' https://acme.fr ',
    });
    expect(created.status).toBe(201);
    const company = (await created.json()) as { id: string; domain: string };
    expect(company.domain).toBe('acme.fr');

    // A contact with a business email attaches to the existing company by domain.
    const contact = await apiCall(t, 'POST', 'contacts', key, { email: 'jo@acme.fr' });
    expect(((await contact.json()) as { companyId: string }).companyId).toBe(company.id);
    // A company hint with a name creates one when nothing matches.
    const hinted = await apiCall(t, 'POST', 'contacts', key, {
      email: 'x@gmail.com',
      company: { name: 'Nouvelle SAS' },
    });
    const hintedCompanyId = ((await hinted.json()) as { companyId: string }).companyId;
    expect(hintedCompanyId).not.toBeNull();
    expect((await apiGet(t, `companies/${hintedCompanyId}`, key)).status).toBe(200);

    const dup = await apiCall(t, 'POST', 'companies', key, { name: 'Acme 2', domain: 'acme.fr' });
    expect(dup.status).toBe(409);
    expect(await errorCode(dup)).toBe('company_domain_exists');

    const patched = await apiCall(t, 'PATCH', `companies/${company.id}`, key, {
      sector: 'Santé',
      domain: null,
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ name: 'Acme', sector: 'Santé', domain: null });

    expect((await apiCall(t, 'DELETE', `companies/${company.id}`, key)).status).toBe(204);
    expect((await apiGet(t, `companies/${company.id}`, key)).status).toBe(404);
  });

  test('deals: create in the default pipeline, move stages through the graph, delete', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ALL_SCOPES);
    const pipelineId = await seedPipeline(t, [
      { key: 'new', kind: 'open' },
      { key: 'qualified', kind: 'open' },
      { key: 'won', kind: 'won' },
      { key: 'lost', kind: 'lost' },
    ]);
    const leadId = await seedLead(t, { email: 'buyer@example.com' });

    const created = await apiCall(t, 'POST', 'deals', key, {
      title: 'Contrat',
      amount: 1200,
      currency: 'eur',
      leadId,
    });
    expect(created.status).toBe(201);
    const deal = (await created.json()) as Record<string, unknown>;
    expect(deal).toMatchObject({
      pipelineId,
      stageKey: 'new',
      status: 'open',
      currency: 'EUR',
      leadId,
    });
    const id = deal.id as string;

    const badAmount = await apiCall(t, 'PATCH', `deals/${id}`, key, { amount: -1 });
    expect(await errorCode(badAmount)).toBe('invalid_deal');
    const readOnly = await apiCall(t, 'PATCH', `deals/${id}`, key, { status: 'won' });
    expect(await errorCode(readOnly)).toBe('read_only_field');

    // new → won is not an arrow of the default graph; new → qualified → won is.
    const forbidden = await apiCall(t, 'PATCH', `deals/${id}`, key, { stageKey: 'won' });
    expect(forbidden.status).toBe(409);
    expect(await errorCode(forbidden)).toBe('deal_transition_forbidden');
    const unknown = await apiCall(t, 'PATCH', `deals/${id}`, key, { stageKey: 'nope' });
    expect(unknown.status).toBe(400);
    expect(await errorCode(unknown)).toBe('unknown_stage');

    expect((await apiCall(t, 'PATCH', `deals/${id}`, key, { stageKey: 'qualified' })).status).toBe(
      200,
    );
    const won = await apiCall(t, 'PATCH', `deals/${id}`, key, {
      stageKey: 'won',
      amount: 1500,
    });
    expect(won.status).toBe(200);
    const wonDeal = (await won.json()) as Record<string, unknown>;
    expect(wonDeal).toMatchObject({ stageKey: 'won', status: 'won', amount: 1500 });
    expect(wonDeal.closedAt).not.toBeNull();

    await t.run(async (ctx) => {
      const history = await ctx.db
        .query('dealStageHistory')
        .withIndex('by_deal', (q) => q.eq('dealId', id as Id<'deals'>))
        .collect();
      expect(history.map((h) => [h.to, h.source])).toEqual([
        ['new', 'api'],
        ['qualified', 'api'],
        ['won', 'api'],
      ]);
      // A won deal turns its lead into a customer (as in the UI).
      expect((await ctx.db.get(leadId))?.lifecycleStage).toBe('customer');
    });

    expect((await apiCall(t, 'DELETE', `deals/${id}`, key)).status).toBe(204);
    expect((await apiGet(t, `deals/${id}`, key)).status).toBe(404);
  });

  test('activities: create, complete through PATCH, link checks, delete', async () => {
    const { t, as, emp } = await setup();
    const { key } = await createKey(as, ALL_SCOPES);
    const leadId = await seedLead(t, { email: 'callee@example.com' });

    const created = await apiCall(t, 'POST', 'activities', key, {
      type: 'task',
      title: 'Rappeler',
      dueAt: Date.now() + 3600_000,
      ownerId: emp.userId,
      leadId,
    });
    expect(created.status).toBe(201);
    const activity = (await created.json()) as Record<string, unknown>;
    expect(activity).toMatchObject({ type: 'task', status: 'open', ownerId: emp.userId, leadId });
    const id = activity.id as string;

    const badLink = await apiCall(t, 'POST', 'activities', key, {
      type: 'note',
      title: 'x',
      dealId: 'notanid',
    });
    expect(await errorCode(badLink)).toBe('invalid_fields');
    const badOwner = await apiCall(t, 'POST', 'activities', key, {
      type: 'note',
      title: 'x',
      ownerId: leadId,
    });
    expect(await errorCode(badOwner)).toBe('invalid_fields');

    const done = await apiCall(t, 'PATCH', `activities/${id}`, key, {
      status: 'done',
      outcome: 'Intéressé',
    });
    expect(done.status).toBe(200);
    const doneActivity = (await done.json()) as Record<string, unknown>;
    expect(doneActivity).toMatchObject({ status: 'done', outcome: 'Intéressé' });
    expect(doneActivity.completedAt).not.toBeNull();

    const reopened = await apiCall(t, 'PATCH', `activities/${id}`, key, { status: 'open' });
    expect(((await reopened.json()) as Record<string, unknown>).completedAt).toBeNull();

    expect((await apiCall(t, 'DELETE', `activities/${id}`, key)).status).toBe(204);
    expect((await apiGet(t, `activities/${id}`, key)).status).toBe(404);
  });

  test('Idempotency-Key replays the first answer and refuses a different body', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ALL_SCOPES);
    const body = { firstName: 'Idem', email: 'idem@example.com' };
    const headers = { 'Idempotency-Key': 'zap-run-42' };

    const first = await apiCall(t, 'POST', 'contacts', key, body, headers);
    expect(first.status).toBe(201);
    expect(first.headers.get('Idempotent-Replayed')).toBeNull();
    const replay = await apiCall(t, 'POST', 'contacts', key, body, headers);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.json()).toEqual(await first.json());

    const reused = await apiCall(t, 'POST', 'contacts', key, { firstName: 'Other' }, headers);
    expect(reused.status).toBe(422);
    expect(await errorCode(reused)).toBe('idempotency_key_reused');

    const leads = await t.run(async (ctx) =>
      (await ctx.db.query('leads').collect()).filter((l) => l.email === 'idem@example.com'),
    );
    expect(leads).toHaveLength(1);

    // Another key may reuse the same Idempotency-Key value.
    const { key: otherKey } = await createKey(as, ALL_SCOPES);
    const fromOther = await apiCall(t, 'POST', 'contacts', otherKey, body, headers);
    expect(fromOther.status).toBe(409);
    expect(await errorCode(fromOther)).toBe('duplicate_email');

    const tooLong = await apiCall(t, 'POST', 'contacts', key, body, {
      'Idempotency-Key': 'x'.repeat(256),
    });
    expect(await errorCode(tooLong)).toBe('invalid_idempotency_key');
  });

  test('writes consume the per-key write budget on top of the request budget', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ALL_SCOPES);
    await frozenNow(async () => {
      for (let i = 0; i < 300; i++) {
        expect((await apiCall(t, 'DELETE', 'contacts/notanid', key)).status).toBe(404);
      }
      const limited = await apiCall(t, 'DELETE', 'contacts/notanid', key);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
      // Reads still go through: only the write bucket is empty.
      expect((await apiGet(t, 'me', key)).status).toBe(200);
    });
  });
});
