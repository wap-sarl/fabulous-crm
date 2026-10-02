import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { computeChanges } from '../../convex/lib/audit/log';
import { asIdentity, createTestConvex, seedConfig, seedEmployee } from './helpers';

describe('what an update changed', () => {
  test('a field given a new value, a field cleared, and nothing for what stays', () => {
    const current = { name: 'Acme', sector: 'Santé', headcount: 12 };
    expect(computeChanges(current, { name: 'Acme SAS', headcount: 12 })).toEqual({
      name: { old: 'Acme', new: 'Acme SAS' },
    });
    // A key set to undefined removes the field when the row is patched: that is a change.
    expect(computeChanges(current, { sector: undefined })).toEqual({
      sector: { old: 'Santé', new: null },
    });
    expect(computeChanges(current, { website: undefined, name: 'Acme' })).toBeUndefined();
    expect(computeChanges(current, {})).toBeUndefined();
  });

  test('clearing the rules of a property is audited', async () => {
    const t = createTestConvex();
    const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
    await seedConfig(t);
    const as = asIdentity(t, admin.identity);
    const definitionId = await as.mutation(api.features.properties.mutations.createDefinition, {
      entityType: 'company',
      label: 'Sièges',
      type: 'number',
      validation: { min: 1, max: 500 },
      showInTable: false,
    });
    await as.mutation(api.features.properties.mutations.updateDefinition, {
      definitionId,
      validation: {},
    });
    expect((await t.run((ctx) => ctx.db.get(definitionId)))?.validation).toBeUndefined();
    const updates = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter(
        (a) => a.entityId === definitionId && a.action === 'update',
      ),
    );
    expect(updates.map((a) => a.metadata)).toEqual([
      { changes: { validation: { old: { min: 1, max: 500 }, new: null } } },
    ]);
  });

  test('a field cleared on an activity, a deal, a company or a pipeline is in the journal', async () => {
    const t = createTestConvex();
    const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
    await seedConfig(t);
    const as = asIdentity(t, admin.identity);
    const lastUpdate = async (entityId: string) =>
      await t.run(
        async (ctx) =>
          (await ctx.db.query('auditLogs').collect())
            .filter((a) => a.entityId === entityId && a.action === 'update')
            .at(-1)?.metadata,
      );

    const activityId = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Envoyer le devis',
      description: 'Avant vendredi',
      dueAt: 1_800_000_000_000,
    });
    await as.mutation(api.features.activities.mutations.updateActivity, {
      activityId,
      description: null,
      dueAt: null,
    });
    expect(await lastUpdate(activityId)).toEqual({
      changes: {
        description: { old: 'Avant vendredi', new: null },
        dueAt: { old: 1_800_000_000_000, new: null },
      },
    });
    // Clearing what is already absent changes nothing.
    await as.mutation(api.features.activities.mutations.updateActivity, {
      activityId,
      description: null,
    });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query('auditLogs').collect()).filter(
          (a) => a.entityId === activityId && a.action === 'update',
        ),
      ),
    ).toHaveLength(1);

    const pipelineId = await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Contrat annuel',
      amount: 1200,
      expectedCloseDate: '2027-01-31',
    });
    await as.mutation(api.features.deals.mutations.updateDeal, {
      dealId,
      amount: null,
      expectedCloseDate: null,
    });
    expect(await lastUpdate(dealId)).toEqual({
      changes: {
        amount: { old: 1200, new: null },
        expectedCloseDate: { old: '2027-01-31', new: null },
      },
    });

    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Novalux',
      sector: 'Énergie',
      website: 'https://novalux.example',
    });
    await as.mutation(api.features.companies.mutations.updateCompany, {
      companyId,
      sector: '',
      website: '',
    });
    expect(await lastUpdate(companyId)).toEqual({
      changes: {
        sector: { old: 'Énergie', new: null },
        website: { old: 'https://novalux.example', new: null },
      },
    });

    const layout = { nodes: [{ key: 'new', x: 10, y: 20 }], arrows: [] };
    await as.mutation(api.features.deals.mutations.updatePipeline, { pipelineId, layout });
    await as.mutation(api.features.deals.mutations.updatePipeline, { pipelineId, layout: null });
    expect(await lastUpdate(pipelineId)).toEqual({
      changes: { layout: { old: layout, new: null } },
    });
  });
});
