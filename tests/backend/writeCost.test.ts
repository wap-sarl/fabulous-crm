import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { type DbCount, countDb } from '../support/dbCounter';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runAll,
  seedConfig,
  seedEmployee,
} from './helpers';

const NOW = Date.parse('2026-10-02T09:00:00Z');

const criteria = (field: string, operator: string, value?: unknown) =>
  ({
    combinator: 'and',
    groups: [
      { combinator: 'and', rules: [{ field: { kind: 'standard', field }, operator, value }] },
    ],
  }) as never;

/** A deployment as it is used: lists kept from imports, two dynamic lists, workflows of which two run. */
async function world(size: { staticLists: number; idleWorkflows: number; scoring?: boolean }) {
  pinClock(NOW);
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  await seedConfig(t);
  const as = asIdentity(t, emp.identity);
  for (let i = 0; i < size.staticLists; i++) {
    await as.mutation(api.features.leadLists.mutations.createLeadList, { name: `Import ${i}` });
  }
  for (const stage of ['customer', 'mql']) {
    await as.mutation(api.features.leadLists.mutations.createLeadList, {
      name: `Les ${stage}`,
      kind: 'dynamic',
      criteria: criteria('lifecycleStage', 'equals', stage),
    });
  }
  const workflow = (name: string) =>
    as.mutation(api.features.workflows.mutations.createWorkflow, {
      name,
      trigger: { type: 'lead_created' },
      allowReEnrollment: false,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
  for (const name of ['Bienvenue', 'Suivi']) {
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId: await workflow(name),
      status: 'active',
    });
  }
  for (let i = 0; i < size.idleWorkflows; i++) await workflow(`Brouillon ${i}`);
  if (size.scoring) {
    await as.mutation(api.features.scoring.mutations.createScoringRule, {
      name: 'A une adresse',
      criteria: criteria('email', 'isNotEmpty'),
      points: 10,
      active: true,
    });
  }
  await runAll(t, NOW);
  const create = () =>
    as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '01 02 03 04 05',
    });
  const update = (leadId: Id<'leads'>, fields: Record<string, unknown>) =>
    as.mutation(api.features.leads.mutations.updateLead, { leadId, ...fields });
  return { t, as, create, update };
}

/** The reads and the writes made in the aggregates (the trees that keep the counts). */
const inAggregates = (count: DbCount) =>
  ['btree', 'btreeNode'].reduce(
    (sum, table) => sum + (count.reads[table] ?? 0) + (count.writes[table] ?? 0),
    0,
  );

describe('what a write of a contact costs', () => {
  test('a new contact is written once: its search text and its duplicate keys go in with it', async () => {
    const { t, create } = await world({ staticLists: 3, idleWorkflows: 1 });
    let leadId = '' as Id<'leads'>;
    const cost = await countDb(async () => {
      leadId = await create();
    });
    expect(cost.writes.leads).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(leadId))).toMatchObject({
      searchText: 'ada lovelace ada example com 01 02 03 04 05 0102030405',
      dedupe: { name: 'lovelace|ada', phone: '+33102030405', block: 'lov' },
    });
  });

  test('the name of its company is in the search text it is created with', async () => {
    const { t, as } = await world({ staticLists: 0, idleWorkflows: 0 });
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Novalux',
    });
    let leadId = '' as Id<'leads'>;
    const cost = await countDb(async () => {
      leadId = await as.mutation(api.features.leads.mutations.createLead, {
        firstName: 'Ada',
        lastName: 'Lovelace',
        companyId,
      });
    });
    expect(cost.writes.leads).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.searchText).toBe('ada lovelace novalux');
  });

  test('a score is the second write, and the last', async () => {
    const { t, create } = await world({ staticLists: 3, idleWorkflows: 1, scoring: true });
    let leadId = '' as Id<'leads'>;
    const cost = await countDb(async () => {
      leadId = await create();
    });
    expect(cost.writes.leads).toBe(2);
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.leadScore).toBe(10);
  });

  test('a write that moves no count leaves the aggregates alone; one that moves a count is counted', async () => {
    const { as, create, update } = await world({ staticLists: 3, idleWorkflows: 1 });
    const leadId = await create();
    expect(inAggregates(await countDb(() => update(leadId, { comment: 'À rappeler' })))).toBe(0);
    expect(inAggregates(await countDb(() => update(leadId, { firstName: 'Augusta' })))).toBe(0);

    const stages = () => as.query(api.features.leads.queries.countLeadsByLifecycleStage, {});
    expect((await stages()).byStage).toMatchObject({ lead: 1 });
    expect(
      inAggregates(await countDb(() => update(leadId, { lifecycleStage: 'mql' }))),
    ).toBeGreaterThan(0);
    expect((await stages()).byStage).toMatchObject({ lead: 0, mql: 1 });
  });

  test('the lists kept from imports and the workflows that do not run cost a write nothing', async () => {
    const costs: DbCount[] = [];
    for (const size of [
      { staticLists: 2, idleWorkflows: 1 },
      { staticLists: 30, idleWorkflows: 12 },
    ]) {
      const { create, update } = await world(size);
      let leadId = '' as Id<'leads'>;
      costs.push(
        await countDb(async () => {
          leadId = await create();
        }),
        await countDb(() => update(leadId, { comment: 'À rappeler' })),
      );
    }
    const [smallCreate, smallUpdate, largeCreate, largeUpdate] = costs;
    expect(largeCreate.reads).toEqual(smallCreate.reads);
    expect(largeUpdate.reads).toEqual(smallUpdate.reads);
    // Each write looks at the two dynamic lists, and the creation at the two workflows that run.
    expect(smallUpdate.reads.leadLists).toBe(2);
    expect(smallCreate.reads.leadLists).toBe(2);
  });

  test('a deal: its title moves no sum, its amount moves them without the deal leaving its stage', async () => {
    const { as } = await world({ staticLists: 0, idleWorkflows: 0 });
    const pipelineId = await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Contrat',
      amount: 100,
    });
    const update = (fields: Record<string, unknown>) =>
      as.mutation(api.features.deals.mutations.updateDeal, { dealId, ...fields });
    const open = async () =>
      (await as.query(api.features.deals.queries.getPipelineStats, { pipelineId }))?.open;

    expect(inAggregates(await countDb(() => update({ title: 'Contrat annuel' })))).toBe(0);
    expect(await open()).toEqual({ count: 1, amount: 100 });
    expect(inAggregates(await countDb(() => update({ amount: 250 })))).toBeGreaterThan(0);
    expect(await open()).toEqual({ count: 1, amount: 250 });
  });

  test('a workflow that was deleted while it ran enrolls nobody', async () => {
    const { t, create } = await world({ staticLists: 0, idleWorkflows: 0 });
    await t.run(async (ctx) => {
      for (const workflow of await ctx.db.query('workflows').collect()) {
        if (workflow.name === 'Suivi') await ctx.db.patch(workflow._id, { deletedAt: NOW });
      }
    });
    const leadId = await create();
    const runs = await t.run(async (ctx) =>
      Promise.all(
        (await ctx.db.query('workflowRuns').collect())
          .filter((run) => run.leadId === leadId)
          .map(async (run) => (await ctx.db.get(run.workflowId))?.name),
      ),
    );
    expect(runs).toEqual(['Bienvenue']);
  });
});
