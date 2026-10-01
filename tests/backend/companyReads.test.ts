import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { apiCall, createKey } from './apiClient';
import { asIdentity, createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const T0 = Date.parse('2026-03-02T09:00:00Z');
const MINUTE = 60_000;

async function setup() {
  // Each write gets its own minute, so the order and the timestamps are exact.
  pinClock(T0);
  const t = createTestConvex();
  const emp = await seedEmployee(t, {
    email: 'ada@example.com',
    role: 'admin',
    firstName: 'Ada',
    lastName: 'Martin',
  });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

const activityOf = (as: ReturnType<typeof asIdentity>, companyId: Id<'companies'>) =>
  as.query(api.features.companies.queries.listCompanyActivity, { companyId });

/** An audit row as the backend writes it for something nobody signed (import job, scheduled work). */
const systemRow = (t: T, companyId: Id<'companies'>, metadata?: unknown) =>
  t.run((ctx) =>
    ctx.db.insert('auditLogs', {
      entityType: 'company',
      entityId: companyId,
      action: 'update',
      timestamp: Date.now(),
      metadata,
    }),
  );

describe('company options', () => {
  test('an instance without company offers no option', async () => {
    const { as } = await setup();
    expect(await as.query(api.features.companies.queries.listCompanyOptions, {})).toEqual([]);
  });

  test('the options are the live companies in name order, reduced to id and name', async () => {
    const { as, emp } = await setup();
    const create = (fields: { name: string; domain?: string; sector?: string }) =>
      as.mutation(api.features.companies.mutations.createCompany, fields);
    const novalux = await create({ name: 'Novalux', domain: 'novalux.example', sector: 'Énergie' });
    const brume = await create({ name: 'Atelier Brume' });
    const meridia = await create({ name: 'Meridia Conseil' });
    await as.mutation(api.features.companies.mutations.updateCompany, {
      companyId: brume,
      ownerIds: [emp.userId],
      headcount: 12,
    });
    await as.mutation(api.features.companies.mutations.deleteCompany, { companyId: meridia });

    expect(await as.query(api.features.companies.queries.listCompanyOptions, {})).toEqual([
      { _id: brume, name: 'Atelier Brume' },
      { _id: novalux, name: 'Novalux' },
    ]);
  });
});

describe('company activity', () => {
  test('a company without audit row has no activity', async () => {
    const { t, as } = await setup();
    const companyId = await t.run((ctx) =>
      ctx.db.insert('companies', {
        name: 'Atelier Brume',
        country: 'FR',
        ownerIds: [],
        updatedAt: Date.now(),
      }),
    );
    expect(await activityOf(as, companyId)).toEqual([]);
  });

  test('rows come most recent first, named after the employee or the API key that acted', async () => {
    const { t, as } = await setup();
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Novalux',
    });
    const other = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Atelier Brume',
    });

    pinClock(T0 + MINUTE);
    await as.mutation(api.features.companies.mutations.updateCompany, {
      companyId,
      sector: 'Énergie',
    });

    pinClock(T0 + 2 * MINUTE);
    const { key } = await createKey(as, ['companies:write']);
    const patched = await apiCall(t, 'PATCH', `companies/${companyId}`, key, { headcount: 40 });
    expect(patched.status).toBe(200);

    pinClock(T0 + 3 * MINUTE);
    const systemId = await systemRow(t, companyId, { source: 'import', revived: true });

    pinClock(T0 + 4 * MINUTE);
    await as.mutation(api.features.companies.mutations.deleteCompany, { companyId });

    const rows = await activityOf(as, companyId);
    expect(rows.map(({ _id, ...row }) => row)).toEqual([
      { action: 'delete', timestamp: T0 + 4 * MINUTE, userName: 'Ada Martin', metadata: null },
      {
        action: 'update',
        timestamp: T0 + 3 * MINUTE,
        userName: null,
        metadata: { source: 'import', revived: true },
      },
      {
        action: 'update',
        timestamp: T0 + 2 * MINUTE,
        userName: 'API · Test key',
        metadata: { changes: { headcount: { new: 40 } } },
      },
      {
        action: 'update',
        timestamp: T0 + MINUTE,
        userName: 'Ada Martin',
        metadata: { changes: { sector: { new: 'Énergie' } } },
      },
      { action: 'create', timestamp: T0, userName: 'Ada Martin', metadata: null },
    ]);
    expect(rows[1]._id).toBe(systemId);

    // The other company keeps its own trail.
    expect((await activityOf(as, other)).map((row) => row.action)).toEqual(['create']);
  });

  test('a company created through the API is credited to the key', async () => {
    const { t, as } = await setup();
    const { key } = await createKey(as, ['companies:write']);
    const created = await apiCall(t, 'POST', 'companies', key, { name: 'Meridia Conseil' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: Id<'companies'> };

    expect(await activityOf(as, id)).toEqual([
      {
        _id: expect.any(String),
        action: 'create',
        timestamp: T0,
        userName: 'API · Test key',
        metadata: null,
      },
    ]);
  });

  test('an actor that no longer exists leaves a row without a name, or the bare « API »', async () => {
    const { t, as } = await setup();
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Novalux',
    });
    const gone = await seedEmployee(t, {
      email: 'leo@example.com',
      role: 'admin',
      firstName: 'Léo',
      lastName: 'Garnier',
    });
    pinClock(T0 + MINUTE);
    await asIdentity(t, gone.identity).mutation(api.features.companies.mutations.updateCompany, {
      companyId,
      sector: 'Énergie',
    });
    pinClock(T0 + 2 * MINUTE);
    const { id: keyId, key } = await createKey(as, ['companies:write']);
    await apiCall(t, 'PATCH', `companies/${companyId}`, key, { headcount: 40 });
    await t.run(async (ctx) => {
      await ctx.db.delete(gone.userId);
      await ctx.db.delete(keyId);
    });

    const rows = await activityOf(as, companyId);
    expect(rows.map((row) => [row.action, row.userName])).toEqual([
      ['update', 'API'],
      ['update', null],
      ['create', 'Ada Martin'],
    ]);
  });

  test('only the 50 most recent rows are listed', async () => {
    const { t, as } = await setup();
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Novalux',
    });
    for (let i = 1; i <= 50; i++) {
      pinClock(T0 + i * MINUTE);
      await systemRow(t, companyId);
    }

    const rows = await activityOf(as, companyId);
    expect(rows).toHaveLength(50);
    expect(rows[0]).toMatchObject({ timestamp: T0 + 50 * MINUTE, userName: null, metadata: null });
    expect(rows.at(-1)?.timestamp).toBe(T0 + MINUTE);
    // The creation, the oldest of the 51, is the one left out.
    expect(rows.some((row) => row.action === 'create')).toBe(false);
  });
});
