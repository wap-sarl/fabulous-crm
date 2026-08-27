import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

async function setup() {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const as = asIdentity(t, admin.identity);
  await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
  const define = (
    args: Omit<
      Parameters<typeof as.mutation<typeof api.features.properties.mutations.createDefinition>>[1],
      'showInTable'
    > & { showInTable?: boolean },
  ) =>
    as.mutation(api.features.properties.mutations.createDefinition, {
      showInTable: false,
      ...args,
    });
  return { t, admin, as, define };
}

describe('custom properties across entities', () => {
  test('definitions are scoped per entity and ordered within it', async () => {
    const { as, define } = await setup();
    const tier = await define({
      entityType: 'deal',
      label: 'Offre',
      type: 'select',
      options: [
        { value: 'basic', label: 'Basique' },
        { value: 'pro', label: 'Pro' },
      ],
    });
    const seats = await define({
      entityType: 'company',
      label: 'Sièges',
      type: 'number',
      validation: { min: 1, max: 500 },
    });
    const specialty = await define({ entityType: 'lead', label: 'Spécialité', type: 'text' });
    const second = await define({ entityType: 'deal', label: 'Source', type: 'text' });

    const list = (entityType?: 'lead' | 'company' | 'deal' | 'activity') =>
      as.query(api.features.properties.queries.listDefinitions, { entityType });
    expect((await list('deal')).map((d) => d._id)).toEqual([tier, second]);
    expect((await list('company')).map((d) => d._id)).toEqual([seats]);
    expect((await list('lead')).map((d) => d._id)).toEqual([specialty]);
    expect((await list('activity')).map((d) => d._id)).toEqual([]);
    expect((await list()).map((d) => d.entityType).sort()).toEqual([
      'company',
      'deal',
      'deal',
      'lead',
    ]);

    await as.mutation(api.features.properties.mutations.reorderDefinitions, {
      definitionIds: [second, tier],
    });
    expect((await list('deal')).map((d) => d._id)).toEqual([second, tier]);
  });

  test('a select property on deals validates server-side (unknown option dropped)', async () => {
    const { t, as, define } = await setup();
    const tier = await define({
      entityType: 'deal',
      label: 'Offre',
      type: 'select',
      options: [{ value: 'pro', label: 'Pro' }],
    });
    const leadDef = await define({ entityType: 'lead', label: 'Spécialité', type: 'text' });

    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Contrat',
      customProperties: {
        [tier]: 'pro',
        // Not a definition of the deal entity → dropped, never stored.
        [leadDef]: 'Radiologie',
        unknown: 'x',
      },
    });
    expect((await t.run((ctx) => ctx.db.get(dealId)))?.customProperties).toEqual({ [tier]: 'pro' });

    await as.mutation(api.features.deals.mutations.updateDeal, {
      dealId,
      customProperties: { [tier]: 'enterprise' },
    });
    expect((await t.run((ctx) => ctx.db.get(dealId)))?.customProperties).toEqual({});
  });

  test('a number property on companies enforces its validation rules', async () => {
    const { t, as, define } = await setup();
    const seats = await define({
      entityType: 'company',
      label: 'Sièges',
      type: 'number',
      validation: { min: 1, max: 500 },
    });
    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Acme',
        customProperties: { [seats]: 1000 },
      }),
    ).rejects.toThrow('invalid_property_value: Sièges');

    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      customProperties: { [seats]: 42 },
    });
    expect((await t.run((ctx) => ctx.db.get(companyId)))?.customProperties).toEqual({
      [seats]: 42,
    });
    await expect(
      as.mutation(api.features.companies.mutations.updateCompany, {
        companyId,
        customProperties: { [seats]: 0 },
      }),
    ).rejects.toThrow('invalid_property_value');
  });

  test('lead properties keep working and stay isolated from other entities', async () => {
    const { t, as, define } = await setup();
    const specialty = await define({ entityType: 'lead', label: 'Spécialité', type: 'text' });
    const seats = await define({ entityType: 'company', label: 'Sièges', type: 'number' });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Marie',
      lastName: 'Curie',
      customProperties: { [specialty]: 'Physique', [seats]: 3 },
    });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.customProperties).toEqual({
      [specialty]: 'Physique',
    });
    // Company forms only see company definitions; lead forms only lead ones.
    const leadDefs = await as.query(api.features.properties.queries.listDefinitions, {
      entityType: 'lead',
    });
    expect(leadDefs.map((d) => d._id)).toEqual([specialty]);
  });

  test('activities carry custom properties too', async () => {
    const { t, as, define } = await setup();
    const channel = await define({
      entityType: 'activity',
      label: 'Canal',
      type: 'radio',
      options: [
        { value: 'phone', label: 'Téléphone' },
        { value: 'visio', label: 'Visio' },
      ],
    });
    const activityId = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'meeting',
      title: 'Démo',
      customProperties: { [channel]: 'visio' },
    });
    expect((await t.run((ctx) => ctx.db.get(activityId)))?.customProperties).toEqual({
      [channel]: 'visio',
    });
    await as.mutation(api.features.activities.mutations.updateActivity, {
      activityId,
      customProperties: {},
    });
    expect((await t.run((ctx) => ctx.db.get(activityId)))?.customProperties).toEqual({});
  });

  test('computed definitions are engine-owned: client values are dropped', async () => {
    const { t, as, admin } = await setup();
    const score = await t.run((ctx) =>
      ctx.db.insert('propertyDefinitions', {
        entityType: 'company',
        label: 'Score',
        type: 'number',
        showInTable: true,
        computed: true,
        updatedAt: Date.now(),
        createdBy: admin.userId,
      }),
    );
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      customProperties: { [score]: 99 },
    });
    expect((await t.run((ctx) => ctx.db.get(companyId)))?.customProperties).toEqual({});
  });

  test('advanced filters match custom and built-in fields of companies and deals', async () => {
    const { as, define } = await setup();
    const seats = await define({ entityType: 'company', label: 'Sièges', type: 'number' });
    const tier = await define({
      entityType: 'deal',
      label: 'Offre',
      type: 'select',
      options: [
        { value: 'basic', label: 'Basique' },
        { value: 'pro', label: 'Pro' },
      ],
    });
    const small = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Petite',
      country: 'FR',
      customProperties: { [seats]: 5 },
    });
    const big = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Grande',
      country: 'DE',
      customProperties: { [seats]: 900 },
    });
    const companies = (filter: unknown) =>
      as
        .query(api.features.companies.queries.listCompaniesPaginated, {
          paginationOpts: { numItems: 10, cursor: null },
          advancedFilter: filter as never,
        })
        .then((r) => r.page.map((c) => c._id as Id<'companies'>));
    expect(
      await companies({
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [{ field: { kind: 'custom', definitionId: seats }, operator: 'gt', value: 100 }],
          },
        ],
      }),
    ).toEqual([big]);
    expect(
      await companies({
        combinator: 'and',
        groups: [
          {
            combinator: 'or',
            rules: [
              { field: { kind: 'standard', field: 'country' }, operator: 'equals', value: ['FR'] },
              { field: { kind: 'standard', field: 'name' }, operator: 'contains', value: 'gran' },
            ],
          },
        ],
      }),
    ).toEqual([big, small]);

    const basic = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Petit contrat',
      amount: 100,
      customProperties: { [tier]: 'basic' },
    });
    const pro = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Gros contrat',
      amount: 5000,
      customProperties: { [tier]: 'pro' },
    });
    const deals = (filter: unknown) =>
      as
        .query(api.features.deals.queries.listDealsPaginated, {
          paginationOpts: { numItems: 10, cursor: null },
          advancedFilter: filter as never,
        })
        .then((r) => r.page.map((d) => d._id));
    expect(
      await deals({
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [
              { field: { kind: 'custom', definitionId: tier }, operator: 'equals', value: ['pro'] },
              { field: { kind: 'standard', field: 'amount' }, operator: 'gt', value: 1000 },
            ],
          },
        ],
      }),
    ).toEqual([pro]);
    expect(
      await deals({
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [
              { field: { kind: 'standard', field: 'status' }, operator: 'equals', value: ['open'] },
            ],
          },
        ],
      }),
    ).toEqual([pro, basic]);
    // A lead-only field is rejected by the validator of the deal filter.
    await expect(
      deals({
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [{ field: { kind: 'standard', field: 'firstName' }, operator: 'isNotEmpty' }],
          },
        ],
      }),
    ).rejects.toThrow();
  });
});
