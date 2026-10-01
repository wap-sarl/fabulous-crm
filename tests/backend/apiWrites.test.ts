import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { API_SCOPES } from '../../convex/_lib/validators/apiKeys';
import { apiCall, createKey, type ErrorBody, errorCode } from './apiClient';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

type Json = Record<string, unknown>;
type Entity = 'lead' | 'company' | 'deal' | 'activity';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  const { id: keyId, key } = await createKey(as, [...API_SCOPES]);
  const post = async (path: string, body: unknown) => apiCall(t, 'POST', path, key, body);
  const patch = async (path: string, body: unknown) => apiCall(t, 'PATCH', path, key, body);
  /** The record a successful write answers with. */
  const ok = async (res: Response, status = 200) => {
    expect(res.status).toBe(status);
    return (await res.json()) as Json & { id: string };
  };
  const refused = async (res: Response, status: number, code: string) => {
    expect(res.status).toBe(status);
    expect(await errorCode(res)).toBe(code);
  };
  const property = (entityType: Entity, label: string) =>
    as.mutation(api.features.properties.mutations.createDefinition, {
      entityType,
      label,
      type: 'text',
      showInTable: false,
    });
  const auditsOf = (entityId: string) =>
    t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter((a) => a.entityId === entityId),
    );
  return { t, emp, as, key, keyId, post, patch, ok, refused, property, auditsOf };
}

function seedPipeline(t: T) {
  return t.run((ctx) =>
    ctx.db.insert('pipelines', {
      name: 'Ventes',
      stages: [
        { key: 'new', label: 'new', kind: 'open' },
        { key: 'won', label: 'won', kind: 'won' },
      ],
      isDefault: true,
      updatedAt: Date.now(),
    }),
  );
}

const jobsNamed = (t: T, name: string) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.state.kind === 'pending' && job.name.includes(name))
      .map((job) => job.args[0] as Json),
  );

describe('public REST API writes: custom properties', () => {
  const RESOURCES: { entity: Entity; path: string; body: Json; other?: Json }[] = [
    {
      entity: 'lead',
      path: 'contacts',
      body: { firstName: 'A', lastName: 'B', email: 'a@example.com' },
      other: { firstName: 'C', lastName: 'D', email: 'c@example.com' },
    },
    { entity: 'company', path: 'companies', body: { name: 'Acme' } },
    { entity: 'deal', path: 'deals', body: { title: 'Contrat' } },
    { entity: 'activity', path: 'activities', body: { type: 'note', title: 'Note' } },
  ];

  for (const { entity, path, body, other = body } of RESOURCES) {
    test(`${path}: a PATCH sets the properties it gives, removes those it gives as null and keeps the rest`, async () => {
      const { t, post, patch, ok, refused, property, auditsOf } = await setup();
      if (entity === 'deal') await seedPipeline(t);
      const [kept, removed, added] = await Promise.all(
        ['Gardée', 'Retirée', 'Ajoutée'].map((label) => property(entity, label)),
      );
      const created = await ok(
        await post(path, { ...body, customProperties: { [kept]: 'k', [removed]: 'r' } }),
        201,
      );
      expect(created.customProperties).toEqual({ [kept]: 'k', [removed]: 'r' });

      const patched = await ok(
        await patch(`${path}/${created.id}`, {
          customProperties: { [removed]: null, [added]: 'a' },
        }),
      );
      expect(patched.customProperties).toEqual({ [kept]: 'k', [added]: 'a' });
      // Removing a property that is not there changes nothing.
      const same = await ok(
        await patch(`${path}/${created.id}`, { customProperties: { [removed]: null } }),
      );
      expect(same.customProperties).toEqual({ [kept]: 'k', [added]: 'a' });
      const updates = (await auditsOf(created.id)).filter((a) => a.action === 'update');
      expect(updates).toHaveLength(1);
      expect((updates[0].metadata as { changes: Json }).changes).toHaveProperty('customProperties');

      await refused(
        await patch(`${path}/${created.id}`, { customProperties: { nope: 'x' } }),
        400,
        'unknown_property',
      );
      // A computed property belongs to the engine that maintains it.
      await t.run((ctx) => ctx.db.patch(kept, { computed: true }));
      const computed = await patch(`${path}/${created.id}`, { customProperties: { [kept]: 'x' } });
      expect(computed.status).toBe(400);
      const error = ((await computed.json()) as ErrorBody).error;
      expect(error.code).toBe('read_only_field');
      expect(error.details).toEqual({ propertyId: kept });
      await refused(
        await post(path, { ...other, customProperties: { [kept]: 'x' } }),
        400,
        'read_only_field',
      );
    });
  }
});

describe('public REST API writes: what a PATCH can change', () => {
  test('contacts: the email, the owners, the company and the stage', async () => {
    const { t, emp, post, patch, ok, refused } = await setup();
    const company = await ok(await post('companies', { name: 'Acme' }), 201);
    const gone = await ok(await post('companies', { name: 'Partie' }), 201);

    // An explicit company wins over the domain of the email; a missing or malformed one is refused.
    const contact = await ok(
      await post('contacts', {
        firstName: 'Ada',
        lastName: 'L',
        email: 'ada@example.com',
        companyId: company.id,
      }),
      201,
    );
    expect(contact.companyId).toBe(company.id);
    await t.run((ctx) => ctx.db.patch(gone.id as Id<'companies'>, { deletedAt: Date.now() }));
    const base = { firstName: 'B', lastName: 'B', email: 'b@example.com' };
    await refused(
      await post('contacts', { ...base, companyId: gone.id }),
      400,
      'company_not_found',
    );
    await refused(await post('contacts', { ...base, companyId: 'notanid' }), 400, 'invalid_fields');

    const path = `contacts/${contact.id}`;
    expect(await ok(await patch(path, { email: ' Ada.L@Example.com ' }))).toMatchObject({
      email: 'ada.l@example.com',
    });
    // Its own email is not a conflict.
    expect(await ok(await patch(path, { email: 'ada.l@example.com' }))).toMatchObject({
      email: 'ada.l@example.com',
    });

    expect(await ok(await patch(path, { ownerIds: [emp.userId] }))).toMatchObject({
      ownerIds: [emp.userId],
    });
    await refused(await patch(path, { ownerIds: ['notanid'] }), 400, 'invalid_fields');

    expect(await ok(await patch(path, { companyId: null }))).toMatchObject({ companyId: null });
    expect(await ok(await patch(path, { companyId: company.id }))).toMatchObject({
      companyId: company.id,
    });
    await refused(await patch(path, { companyId: gone.id }), 400, 'company_not_found');

    const history = () =>
      t.run(async (ctx) =>
        (await ctx.db.query('lifecycleStageHistory').collect())
          .filter((h) => h.leadId === contact.id)
          .map((h) => [h.from ?? null, h.to, h.source]),
      );
    expect(await history()).toEqual([[null, 'lead', 'api']]);
    expect(await ok(await patch(path, { lifecycleStage: 'mql' }))).toMatchObject({
      lifecycleStage: 'mql',
    });
    expect(await history()).toEqual([
      [null, 'lead', 'api'],
      ['lead', 'mql', 'api'],
    ]);
    // The same stage is no change; a step back and an unknown stage are refused.
    await ok(await patch(path, { lifecycleStage: 'mql' }));
    await refused(
      await patch(path, { lifecycleStage: 'lead' }),
      409,
      'lifecycle_regression_blocked',
    );
    await refused(await patch(path, { lifecycleStage: 'nope' }), 400, 'unknown_lifecycle_stage');
    expect(await history()).toHaveLength(2);
  });

  test('companies: the name, the address and the owners; a new name restamps its contacts', async () => {
    const { t, emp, post, patch, ok, refused } = await setup();
    const company = await ok(await post('companies', { name: 'Acme' }), 201);
    const path = `companies/${company.id}`;

    await refused(await patch(path, { name: '  ' }), 400, 'company_name_required');
    expect(await jobsNamed(t, 'restampCompanyLeadsSearchText')).toEqual([]);
    expect(await ok(await patch(path, { name: ' Acme SAS ' }))).toMatchObject({ name: 'Acme SAS' });
    expect(await jobsNamed(t, 'restampCompanyLeadsSearchText')).toEqual([
      { companyId: company.id },
    ]);
    // The same name again restamps nothing more.
    await ok(await patch(path, { name: 'Acme SAS', sector: 'Santé' }));
    expect(await jobsNamed(t, 'restampCompanyLeadsSearchText')).toHaveLength(1);

    const address = {
      country: 'FR',
      streetNumber: '1',
      street: 'rue de la Paix',
      postalCode: '75002',
      city: 'Paris',
    };
    expect((await ok(await patch(path, { address }))).address).toMatchObject(address);
    expect(await ok(await patch(path, { address: null }))).toMatchObject({ address: null });
    expect(await ok(await patch(path, { ownerIds: [emp.userId] }))).toMatchObject({
      ownerIds: [emp.userId],
    });
    expect(
      await ok(await patch(path, { website: ' https://acme.fr ', headcount: 12 })),
    ).toMatchObject({
      website: 'https://acme.fr',
      headcount: 12,
    });
    expect(await ok(await patch(path, { website: null, headcount: null }))).toMatchObject({
      website: null,
      headcount: null,
    });
  });

  test('deleting a company detaches its contacts later', async () => {
    const { t, key, post, ok } = await setup();
    const company = await ok(await post('companies', { name: 'Acme' }), 201);
    expect((await apiCall(t, 'DELETE', `companies/${company.id}`, key)).status).toBe(204);
    expect(await jobsNamed(t, 'detachCompanyLeads')).toEqual([{ companyId: company.id }]);
    expect((await apiCall(t, 'DELETE', `companies/${company.id}`, key)).status).toBe(404);
    expect(await jobsNamed(t, 'detachCompanyLeads')).toHaveLength(1);
  });

  test('deals: the owners, the contact and the campaign; stage tags need a stage', async () => {
    const { t, emp, post, patch, ok, refused } = await setup();
    await seedPipeline(t);
    const leadId = await seedLead(t, { email: 'buyer@example.com' });
    const campaignId = await t.run((ctx) =>
      ctx.db.insert('campaigns', {
        name: 'Relance',
        status: 'draft',
        totalCount: 0,
        sentCount: 0,
        failedCount: 0,
        updatedAt: Date.now(),
      }),
    );
    const deal = await ok(
      await post('deals', { title: 'Contrat', sourceCampaignId: campaignId }),
      201,
    );
    expect(deal).toMatchObject({ leadId: null, sourceCampaignId: campaignId });
    const path = `deals/${deal.id}`;

    const tags = await patch(path, { stageTags: ['x'] });
    expect(tags.status).toBe(400);
    const error = ((await tags.json()) as ErrorBody).error;
    expect(error.code).toBe('invalid_fields');
    expect(error.details).toEqual({ path: '.stageTags' });
    await refused(await patch(path, { stageComment: 'x' }), 400, 'invalid_fields');

    expect(await ok(await patch(path, { ownerIds: [emp.userId] }))).toMatchObject({
      ownerIds: [emp.userId],
    });
    expect(await ok(await patch(path, { leadId }))).toMatchObject({ leadId });
    expect(await ok(await patch(path, { leadId: null }))).toMatchObject({ leadId: null });
    await refused(await patch(path, { leadId: 'notanid' }), 400, 'invalid_fields');
    expect(await ok(await patch(path, { sourceCampaignId: null }))).toMatchObject({
      sourceCampaignId: null,
    });
    expect(await ok(await patch(path, { sourceCampaignId: campaignId }))).toMatchObject({
      sourceCampaignId: campaignId,
    });
    expect(
      await ok(
        await patch(path, {
          title: ' Contrat 2 ',
          currency: 'usd',
          expectedCloseDate: '2026-12-31',
        }),
      ),
    ).toMatchObject({ title: 'Contrat 2', currency: 'USD', expectedCloseDate: '2026-12-31' });
    expect(await ok(await patch(path, { expectedCloseDate: null, amount: null }))).toMatchObject({
      expectedCloseDate: null,
      amount: null,
    });
  });

  test('activities: the team and the owner, the title, the links', async () => {
    const { t, emp, post, patch, ok, refused } = await setup();
    const team = (deletedAt?: number) =>
      t.run((ctx) =>
        ctx.db.insert('teams', { name: 'Ventes', memberIds: [], updatedAt: Date.now(), deletedAt }),
      );
    const teamId = await team();
    const deletedTeam = await team(Date.now());
    const leadId = await seedLead(t, { email: 'callee@example.com' });
    const note = { type: 'task', title: 'Rappeler' };

    const activity = await ok(await post('activities', { ...note, teamId, leadId }), 201);
    expect(activity).toMatchObject({ teamId, ownerId: null, leadId });
    await refused(
      await post('activities', { ...note, teamId: deletedTeam }),
      400,
      'team_not_found',
    );
    await refused(await post('activities', { ...note, teamId: 'notanid' }), 400, 'invalid_fields');
    const path = `activities/${activity.id}`;

    await refused(await patch(path, { title: '  ' }), 400, 'activity_title_required');
    expect(await ok(await patch(path, { title: ' Rappeler demain ', type: 'call' }))).toMatchObject(
      {
        title: 'Rappeler demain',
        type: 'call',
      },
    );
    expect(await ok(await patch(path, { ownerId: emp.userId, teamId: null }))).toMatchObject({
      ownerId: emp.userId,
      teamId: null,
    });
    expect(await ok(await patch(path, { ownerId: null, teamId }))).toMatchObject({
      ownerId: null,
      teamId,
    });
    await refused(await patch(path, { teamId: deletedTeam }), 400, 'team_not_found');
    await refused(await patch(path, { ownerId: leadId }), 400, 'invalid_fields');

    expect(
      await ok(
        await patch(path, { description: ' Détails ', dueAt: 1_800_000_000_000, outcome: ' Ok ' }),
      ),
    ).toMatchObject({ description: 'Détails', dueAt: 1_800_000_000_000, outcome: 'Ok' });
    expect(
      await ok(await patch(path, { description: null, dueAt: null, outcome: null })),
    ).toMatchObject({
      description: null,
      dueAt: null,
      outcome: null,
    });
    expect(await ok(await patch(path, { leadId: null }))).toMatchObject({ leadId: null });
  });

  test('every write is audited under its resource and its key: create, update, delete', async () => {
    const { t, key, keyId, post, patch, ok } = await setup();
    await seedPipeline(t);
    const cases = [
      {
        path: 'contacts',
        entityType: 'lead',
        body: { firstName: 'A', lastName: 'B', email: 'a@example.com' },
        change: { comment: 'x' },
      },
      {
        path: 'companies',
        entityType: 'company',
        body: { name: 'Acme' },
        change: { sector: 'Santé' },
      },
      { path: 'deals', entityType: 'deal', body: { title: 'Contrat' }, change: { amount: 10 } },
      {
        path: 'activities',
        entityType: 'activity',
        body: { type: 'note', title: 'Note' },
        change: { outcome: 'Ok' },
      },
    ];
    for (const { path, entityType, body, change } of cases) {
      const { id } = await ok(await post(path, body), 201);
      await ok(await patch(`${path}/${id}`, change));
      // A PATCH that changes nothing leaves no trace.
      await ok(await patch(`${path}/${id}`, change));
      expect((await apiCall(t, 'DELETE', `${path}/${id}`, key)).status).toBe(204);
      const audits = await t.run(async (ctx) =>
        (await ctx.db.query('auditLogs').collect()).filter((a) => a.entityId === id),
      );
      const trail = audits.filter((a) => ['create', 'update', 'delete'].includes(a.action));
      const seen: unknown[][] = trail.map((a) => [
        a.entityType,
        a.action,
        a.apiKeyId,
        a.userId ?? null,
      ]);
      expect(seen).toEqual([
        [entityType, 'create', keyId, null],
        [entityType, 'update', keyId, null],
        [entityType, 'delete', keyId, null],
      ]);
      expect((trail[1].metadata as { changes: Json }).changes).toHaveProperty(
        Object.keys(change)[0],
      );
      const row = await t.run((ctx) => ctx.db.get(id as Id<'leads'>));
      expect(row?.deletedAt).toBeDefined();
    }
  });

  test('clearing a field the record does not have changes nothing: no audit, no workflow', async () => {
    const { t, emp, post, patch, ok, auditsOf } = await setup();
    await seedPipeline(t);
    const watching = await t.run((ctx) =>
      ctx.db.insert('workflows', {
        name: 'Suivi',
        status: 'active',
        trigger: { type: 'lead_property_changed' },
        allowReEnrollment: true,
        nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
        startNodeId: 'n1',
        enrolledCount: 0,
        activeCount: 0,
        completedCount: 0,
        updatedAt: Date.now(),
        createdBy: emp.userId,
      }),
    );
    const cases = [
      {
        path: 'contacts',
        body: { firstName: 'A', lastName: 'B', email: 'a@example.com' },
        absent: { phone: null, address: null, companyId: null },
      },
      {
        path: 'companies',
        body: { name: 'Acme' },
        absent: { website: null, sector: null, headcount: null, address: null },
      },
      {
        path: 'deals',
        body: { title: 'Contrat' },
        absent: { amount: null, expectedCloseDate: null, leadId: null, sourceCampaignId: null },
      },
      {
        path: 'activities',
        body: { type: 'note', title: 'Note' },
        absent: {
          description: null,
          dueAt: null,
          outcome: null,
          ownerId: null,
          teamId: null,
          leadId: null,
          companyId: null,
          dealId: null,
        },
      },
    ];
    for (const { path, body, absent } of cases) {
      const created = await ok(await post(path, body), 201);
      expect(created).toMatchObject(absent);
      const { updatedAt: _before, ...before } = created;
      const { updatedAt: _after, ...after } = await ok(
        await patch(`${path}/${created.id}`, absent),
      );
      expect(after).toEqual(before);
      expect((await auditsOf(created.id)).map((a) => a.action)).toEqual(['create']);
    }
    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow', (q) => q.eq('workflowId', watching))
        .collect(),
    );
    expect(runs).toEqual([]);
  });
});
