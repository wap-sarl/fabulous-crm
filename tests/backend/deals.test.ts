import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  DEFAULT_PIPELINE_STAGES,
  defaultTransitions,
  fullTransitions,
} from '../../convex/_lib/validators/deals';
import { asIdentity, createTestConvex, seedEmployee, type SeededEmployee, type T } from './helpers';

// The stock funnel, one arrow per step; won and lost from the last open stage.
const LINEAR = [
  { from: 'new', to: 'qualified' },
  { from: 'qualified', to: 'proposal' },
  { from: 'proposal', to: 'negotiation' },
  { from: 'negotiation', to: 'won' },
  { from: 'negotiation', to: 'lost' },
];

async function setup(role: 'admin' | 'member' = 'admin') {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role });
  const as = asIdentity(t, emp.identity);
  const pipelineId = await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
  // The default graph is linear; most scenarios move deals freely, so allow everything.
  await as.mutation(api.features.deals.mutations.updatePipeline, {
    pipelineId,
    transitions: fullTransitions([...DEFAULT_PIPELINE_STAGES]),
  });
  return { t, emp, as, pipelineId };
}

async function dealOf(t: T, dealId: Id<'deals'>) {
  return (await t.run((ctx) => ctx.db.get(dealId)))!;
}

async function historyOf(t: T, dealId: Id<'deals'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('dealStageHistory')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .collect(),
  );
}

describe('pipelines', () => {
  test('ensureDefaultPipeline creates the stock pipeline once', async () => {
    const { as, pipelineId } = await setup();
    const again = await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    expect(again).toBe(pipelineId);
    const pipelines = await as.query(api.features.deals.queries.listPipelines, {});
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].isDefault).toBe(true);
    expect(pipelines[0].stages.map((s) => s.key)).toEqual(
      DEFAULT_PIPELINE_STAGES.map((s) => s.key),
    );
  });

  test('stage lists are validated; keys in use cannot be removed; admin-only', async () => {
    const { as, pipelineId } = await setup();
    await expect(
      as.mutation(api.features.deals.mutations.updatePipeline, {
        pipelineId,
        stages: DEFAULT_PIPELINE_STAGES.filter((s) => s.kind !== 'won'),
      }),
    ).rejects.toThrow('pipeline_no_won_stage');

    await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Deal',
      stageKey: 'qualified',
    });
    await expect(
      as.mutation(api.features.deals.mutations.updatePipeline, {
        pipelineId,
        stages: DEFAULT_PIPELINE_STAGES.filter((s) => s.key !== 'qualified'),
      }),
    ).rejects.toThrow('pipeline_stage_in_use');
    await expect(
      as.mutation(api.features.deals.mutations.deletePipeline, { pipelineId }),
    ).rejects.toThrow('pipeline_in_use');

    // Moving a closed stage away from the end is refused; open stages reorder freely.
    await expect(
      as.mutation(api.features.deals.mutations.updatePipeline, {
        pipelineId,
        stages: [...DEFAULT_PIPELINE_STAGES].reverse(),
      }),
    ).rejects.toThrow('pipeline_closed_stage_misplaced');
    const open = DEFAULT_PIPELINE_STAGES.filter((s) => s.kind === 'open').reverse();
    const closed = DEFAULT_PIPELINE_STAGES.filter((s) => s.kind !== 'open');
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      name: 'Ventes',
      stages: [...open, ...closed].map((s) => ({ ...s, label: `${s.label} !` })),
    });
    const [pipeline] = await as.query(api.features.deals.queries.listPipelines, {});
    expect(pipeline.name).toBe('Ventes');
    expect(pipeline.stages[0]).toMatchObject({ key: 'negotiation', label: 'Négociation !' });
    expect(pipeline.stages.at(-1)).toMatchObject({ key: 'lost', label: 'Perdue !' });

    const t2 = createTestConvex();
    const member = await seedEmployee(t2, { email: 'm@example.com', role: 'member' });
    await expect(
      asIdentity(t2, member.identity).mutation(api.features.deals.mutations.createPipeline, {
        name: 'X',
        stages: [...DEFAULT_PIPELINE_STAGES],
      }),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('pipeline stage tags', () => {
  test('stage tags are validated; deals can be filtered on a tag', async () => {
    const { t, as, pipelineId } = await setup();
    const withTags = (tags: { key: string; label: string }[], tagsRequired = true) =>
      DEFAULT_PIPELINE_STAGES.map((s) => (s.key === 'lost' ? { ...s, tags, tagsRequired } : s));
    await expect(
      as.mutation(api.features.deals.mutations.updatePipeline, {
        pipelineId,
        stages: withTags([{ key: 'Bad Key', label: 'x' }]),
      }),
    ).rejects.toThrow('pipeline_invalid_tag_key');
    await expect(
      as.mutation(api.features.deals.mutations.updatePipeline, {
        pipelineId,
        stages: withTags([
          { key: 'a', label: 'A' },
          { key: 'a', label: 'B' },
        ]),
      }),
    ).rejects.toThrow('pipeline_duplicate_tag');
    await expect(
      as.mutation(api.features.deals.mutations.updatePipeline, {
        pipelineId,
        stages: withTags([{ key: 'a', label: ' ' }]),
      }),
    ).rejects.toThrow('pipeline_empty_tag_label');
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      stages: withTags([
        { key: 'too_expensive', label: 'Trop cher' },
        { key: 'competitor', label: 'Concurrent' },
      ]),
    });

    const a = await as.mutation(api.features.deals.mutations.createDeal, { title: 'A' });
    const b = await as.mutation(api.features.deals.mutations.createDeal, { title: 'B' });
    await as.mutation(api.features.deals.mutations.createDeal, { title: 'C' });
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId: a,
      stageKey: 'lost',
      tags: ['competitor'],
    });
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId: b,
      stageKey: 'lost',
      tags: ['too_expensive'],
      comment: 'Devis trop haut',
    });
    const filtered = await as.query(api.features.deals.queries.listDealsPaginated, {
      pipelineId,
      advancedFilter: {
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [
              {
                field: { kind: 'standard', field: 'stageTags' },
                operator: 'contains',
                value: ['competitor'],
              },
            ],
          },
        ],
      },
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(filtered.page.map((d) => d.title)).toEqual(['A']);
    // Creating a deal directly in a tagged stage takes tags (at least one) and a comment too.
    await expect(
      as.mutation(api.features.deals.mutations.createDeal, { title: 'D', stageKey: 'lost' }),
    ).rejects.toThrow('stage_tag_required');
    const d = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'D',
      stageKey: 'lost',
      stageTags: ['competitor'],
      stageComment: 'Perdu d’entrée',
    });
    const created = (await as.query(api.features.deals.queries.getDeal, { dealId: d }))!;
    expect(created.deal.stageTagLabels).toEqual(['Concurrent']);
    expect(created.history[0]).toMatchObject({ tags: ['Concurrent'], comment: 'Perdu d’entrée' });

    // With the requirement switched off, the tags stay optional.
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      stages: withTags(
        [
          { key: 'too_expensive', label: 'Trop cher' },
          { key: 'competitor', label: 'Concurrent' },
        ],
        false,
      ),
    });
    const e = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'E',
      stageKey: 'lost',
      stageComment: 'Sans motif',
    });
    expect((await dealOf(t, e)).stageTags).toBeUndefined();
  });
});

describe('deals', () => {
  test('creation lands in the default pipeline/stage, logs history, audits, links the lead', async () => {
    const { t, as, emp, pipelineId } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@acme.fr',
    });
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: '  Contrat annuel ',
      amount: 12000,
      currency: 'eur',
      leadId,
    });
    const deal = await dealOf(t, dealId);
    expect(deal).toMatchObject({
      title: 'Contrat annuel',
      amount: 12000,
      currency: 'EUR',
      pipelineId,
      stageKey: 'new',
      status: 'open',
      ownerIds: [emp.userId],
      leadId,
    });
    const history = await historyOf(t, dealId);
    expect(history).toMatchObject([{ to: 'new', source: 'create' }]);
    expect(history[0].from).toBeUndefined();
    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'deal').eq('entityId', dealId))
        .collect(),
    );
    expect(audit.map((a) => a.action)).toEqual(['create']);

    await expect(
      as.mutation(api.features.deals.mutations.createDeal, { title: 'Bad', amount: -1 }),
    ).rejects.toThrow('invalid_deal: amount');
    await expect(
      as.mutation(api.features.deals.mutations.createDeal, { title: 'Bad', stageKey: 'nope' }),
    ).rejects.toThrow('unknown_stage');
  });

  test('stage moves record history, stamp closedAt, tags and comment, and reopen cleanly', async () => {
    const { t, as, pipelineId } = await setup();
    // Loss reasons live on the lost stage as tags.
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      stages: DEFAULT_PIPELINE_STAGES.map((s) =>
        s.key === 'lost'
          ? {
              ...s,
              tags: [
                { key: 'too_expensive', label: 'Trop cher' },
                { key: 'competitor', label: 'Concurrent' },
              ],
              tagsRequired: true,
            }
          : s,
      ),
    });
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Deal',
    });
    await as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'proposal' });
    expect(await dealOf(t, dealId)).toMatchObject({
      stageKey: 'proposal',
      status: 'open',
    });
    // Same stage: no-op, no history row.
    expect(
      await as.mutation(api.features.deals.mutations.moveDealStage, {
        dealId,
        stageKey: 'proposal',
      }),
    ).toBe('unchanged');

    // A tag that is not one of the stage's is refused; a tagged stage needs at least one.
    await expect(
      as.mutation(api.features.deals.mutations.moveDealStage, {
        dealId,
        stageKey: 'lost',
        tags: ['nope'],
      }),
    ).rejects.toThrow('unknown_stage_tag');
    await expect(
      as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'lost' }),
    ).rejects.toThrow('stage_tag_required');
    // Won has no tags: nothing is required there.
    await as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'won' });
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'proposal',
    });
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'lost',
      tags: ['too_expensive', 'competitor', 'too_expensive'],
      comment: '  Budget gelé  ',
    });
    let deal = await dealOf(t, dealId);
    expect(deal).toMatchObject({
      status: 'lost',
      stageTags: ['too_expensive', 'competitor'],
      stageComment: 'Budget gelé',
    });
    expect(deal.closedAt).toBeDefined();
    const page = await as.query(api.features.deals.queries.getDeal, { dealId });
    expect(page?.deal.stageTagLabels).toEqual(['Trop cher', 'Concurrent']);

    // Reopening clears the deal's stage tags; the history keeps them.
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'negotiation',
    });
    deal = await dealOf(t, dealId);
    expect(deal).toMatchObject({ status: 'open', stageKey: 'negotiation' });
    expect(deal.closedAt).toBeUndefined();
    expect(deal.stageTags).toBeUndefined();
    expect(deal.stageComment).toBeUndefined();

    const history = await historyOf(t, dealId);
    expect(history.map((h) => h.to)).toEqual([
      'new',
      'proposal',
      'won',
      'proposal',
      'lost',
      'negotiation',
    ]);
    expect(history[4]).toMatchObject({
      tags: ['too_expensive', 'competitor'],
      comment: 'Budget gelé',
    });
    expect(history[5].tags).toBeUndefined();
    const rows = (await as.query(api.features.deals.queries.getDeal, { dealId }))?.history ?? [];
    expect(rows[4]).toMatchObject({ tags: ['Trop cher', 'Concurrent'], comment: 'Budget gelé' });
    await expect(
      as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'nope' }),
    ).rejects.toThrow('unknown_stage');
  });

  test('per-stage and per-status counts and sums come from the aggregates', async () => {
    const { as, pipelineId } = await setup();
    const a = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'A',
      amount: 100,
    });
    await as.mutation(api.features.deals.mutations.createDeal, { title: 'B', amount: 250 });
    const c = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'C',
      amount: 1000,
      stageKey: 'won',
    });

    let stats = (await as.query(api.features.deals.queries.getPipelineStats, { pipelineId }))!;
    expect(stats.stages.find((s) => s.key === 'new')).toMatchObject({ count: 2, amount: 350 });
    expect(stats.open).toEqual({ count: 2, amount: 350 });
    expect(stats.won).toEqual({ count: 1, amount: 1000 });

    await as.mutation(api.features.deals.mutations.moveDealStage, { dealId: a, stageKey: 'won' });
    await as.mutation(api.features.deals.mutations.updateDeal, { dealId: c, amount: 1500 });
    await as.mutation(api.features.deals.mutations.deleteDeal, { dealId: c });
    stats = (await as.query(api.features.deals.queries.getPipelineStats, { pipelineId }))!;
    expect(stats.stages.find((s) => s.key === 'new')).toMatchObject({ count: 1, amount: 250 });
    expect(stats.won).toEqual({ count: 1, amount: 100 });
    expect(stats.open).toEqual({ count: 1, amount: 250 });
  });

  test('Kanban columns and the list view paginate through the pipeline indexes', async () => {
    const { as, emp, pipelineId } = await setup();
    await as.mutation(api.features.deals.mutations.createDeal, { title: 'Alpha' });
    await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Beta',
      stageKey: 'qualified',
    });
    await as.mutation(api.features.deals.mutations.createDeal, { title: 'Gamma', stageKey: 'won' });

    const column = await as.query(api.features.deals.queries.listStageDeals, {
      pipelineId,
      stageKey: 'qualified',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(column.page.map((d) => d.title)).toEqual(['Beta']);
    expect(column.page[0]).toMatchObject({
      stageLabel: 'Qualifiée',
      ownerNames: ['Test User'],
    });

    const open = await as.query(api.features.deals.queries.listDealsPaginated, {
      pipelineId,
      statuses: ['open'],
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(open.page.map((d) => d.title).sort()).toEqual(['Alpha', 'Beta']);
    const search = await as.query(api.features.deals.queries.listDealsPaginated, {
      ownerIds: [emp.userId],
      search: 'gam',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(search.page.map((d) => d.title)).toEqual(['Gamma']);
  });

  test('winning a deal promotes its lead to customer (lifecycle) and fires deal_won', async () => {
    const { t, as } = await setup();
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Onboarding',
      trigger: { type: 'deal_won' },
      allowReEnrollment: false,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
    });
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Deal',
      leadId,
    });
    await as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'won' });

    expect((await t.run((ctx) => ctx.db.get(leadId)))?.lifecycleStage).toBe('customer');
    const lifecycle = await t.run((ctx) =>
      ctx.db
        .query('lifecycleStageHistory')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .collect(),
    );
    expect(lifecycle.at(-1)).toMatchObject({ to: 'customer', source: 'deal' });
    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) => q.eq('workflowId', workflowId).eq('leadId', leadId))
        .collect(),
    );
    expect(runs).toHaveLength(1);
  });

  test('deal_stage_changed enrolls only for the configured pipeline stage', async () => {
    const { t, as, pipelineId } = await setup();
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Proposition envoyée',
      trigger: { type: 'deal_stage_changed', pipelineId, stageKey: 'proposal' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
    });
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Deal',
      leadId,
    });
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'qualified',
    });
    const count = () =>
      t.run(
        async (ctx) =>
          (
            await ctx.db
              .query('workflowRuns')
              .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
              .collect()
          ).length,
      );
    expect(await count()).toBe(0);
    await as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'proposal' });
    expect(await count()).toBe(1);
  });
});

describe('workflow deal steps', () => {
  async function runStep(t: T, workflowId: Id<'workflows'>, leadId: Id<'leads'>) {
    const runId = await t.run((ctx) =>
      ctx.db.insert('workflowRuns', {
        workflowId,
        leadId,
        status: 'active',
        triggerType: 'manual',
        enrolledAt: Date.now(),
        currentNodeId: 'n1',
        stepCount: 0,
      }),
    );
    await t.run((ctx) => ctx.db.patch(workflowId, { activeCount: 1, enrolledCount: 1 }));
    await t.mutation(internal.features.workflows.internal.executeStep, { runId, nodeId: 'n1' });
    const steps = await t.run((ctx) =>
      ctx.db
        .query('workflowRunSteps')
        .withIndex('by_run', (q) => q.eq('runId', runId))
        .collect(),
    );
    return steps[0];
  }

  async function activeWorkflow(t: T, emp: SeededEmployee, node: Record<string, unknown>) {
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Deals',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', ...node } as never],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    return workflowId;
  }

  test('create_deal renders the title from the lead and attaches lead and owner', async () => {
    const { t, as, emp, pipelineId } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@acme.fr',
      ownerIds: [emp.userId],
    });
    const workflowId = await activeWorkflow(t, emp, {
      type: 'create_deal',
      title: 'Devis {{ params.lastName }}',
      amount: 500,
      stageKey: 'qualified',
    });
    const step = await runStep(t, workflowId, leadId);
    expect(step.status).toBe('success');
    const deals = await as.query(api.features.deals.queries.listDealsForEntity, { leadId });
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      title: 'Devis Dupont',
      amount: 500,
      pipelineId,
      stageKey: 'qualified',
      ownerIds: [emp.userId],
    });
    expect((await historyOf(t, deals[0]._id))[0]).toMatchObject({ source: 'workflow', workflowId });
  });

  test('update_deal_stage moves the lead’s latest open deal; skips when there is none', async () => {
    const { t, as, emp } = await setup();
    const workflowId = await activeWorkflow(t, emp, { type: 'update_deal_stage', stageKey: 'won' });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
    });

    expect((await runStep(t, workflowId, leadId)).status).toBe('skipped');

    const older = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Old',
      leadId,
    });
    const newer = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'New',
      leadId,
    });
    const step = await runStep(t, workflowId, leadId);
    expect(step.status).toBe('success');
    expect((await dealOf(t, newer)).status).toBe('won');
    expect((await dealOf(t, older)).status).toBe('open');
    expect((await historyOf(t, newer)).at(-1)).toMatchObject({
      to: 'won',
      source: 'workflow',
      workflowId,
    });
  });

  test('activation refuses a stage that no pipeline has', async () => {
    const { as } = await setup();
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Bad',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: false,
      nodes: [{ id: 'n1', type: 'update_deal_stage', stageKey: 'nope' }],
      startNodeId: 'n1',
    });
    await expect(
      as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
        workflowId,
        status: 'active',
      }),
    ).rejects.toThrow('stade introuvable');
  });

  test('activation refuses a step whose move is not an arrow of the pipeline graph', async () => {
    const { as, pipelineId } = await setup();
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: LINEAR,
    });
    const make = (stageKey: string) =>
      as.mutation(api.features.workflows.mutations.createWorkflow, {
        name: 'Jump',
        // The trigger pins the source stage: « Nouvelle » deals entering the pipeline.
        trigger: { type: 'deal_stage_changed', pipelineId, stageKey: 'new' },
        allowReEnrollment: false,
        nodes: [{ id: 'n1', type: 'update_deal_stage', pipelineId, stageKey }],
        startNodeId: 'n1',
      });
    const bad = await make('won');
    await expect(
      as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
        workflowId: bad,
        status: 'active',
      }),
    ).rejects.toThrow('transition interdite de « Nouvelle » vers « Gagnée »');
    const good = await make('qualified');
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId: good,
      status: 'active',
    });
  });

  test('a forbidden move at run time skips the step instead of failing the run', async () => {
    const { t, as, emp, pipelineId } = await setup();
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: LINEAR,
    });
    const workflowId = await activeWorkflow(t, emp, { type: 'update_deal_stage', stageKey: 'won' });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
    });
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'New',
      leadId,
    });
    const step = await runStep(t, workflowId, leadId);
    expect(step.status).toBe('skipped');
    expect(step.detail).toContain('transition interdite');
    expect((await dealOf(t, dealId)).stageKey).toBe('new');
  });

  test('update_deal_stage sets its fixed tags; activation refuses a tag the stage lacks', async () => {
    const { t, as, emp, pipelineId } = await setup();
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      stages: DEFAULT_PIPELINE_STAGES.map((s) =>
        s.key === 'lost'
          ? { ...s, tags: [{ key: 'no_answer', label: 'Sans réponse' }], tagsRequired: true }
          : s,
      ),
    });
    const activate = (workflowId: Id<'workflows'>) =>
      as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
        workflowId,
        status: 'active',
      });
    const draft = (tags?: string[]) =>
      as.mutation(api.features.workflows.mutations.createWorkflow, {
        name: 'Tags',
        trigger: { type: 'consent_updated' },
        allowReEnrollment: false,
        nodes: [{ id: 'n1', type: 'update_deal_stage', stageKey: 'lost', tags }],
        startNodeId: 'n1',
      });
    await expect(activate(await draft(['nope']))).rejects.toThrow('étiquette introuvable');
    await expect(activate(await draft())).rejects.toThrow('choisissez au moins une étiquette');

    const workflowId = await activeWorkflow(t, emp, {
      type: 'update_deal_stage',
      stageKey: 'lost',
      tags: ['no_answer'],
    });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
    });
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Silent',
      leadId,
    });
    expect((await runStep(t, workflowId, leadId)).status).toBe('success');
    expect(await dealOf(t, dealId)).toMatchObject({ status: 'lost', stageTags: ['no_answer'] });
    expect((await historyOf(t, dealId)).at(-1)).toMatchObject({
      tags: ['no_answer'],
      source: 'workflow',
    });
  });
});

describe('pipeline transition graph', () => {
  const linear = LINEAR;

  test('the saved layout is stored, pruned to the stages, and cleared with null', async () => {
    const { t, as, pipelineId } = await setup();
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      layout: {
        nodes: [
          { key: 'new', x: 10, y: 20 },
          { key: 'ghost', x: 0, y: 0 },
        ],
        arrows: [
          { from: 'new', to: 'qualified', x: 5, y: -5 },
          { from: 'new', to: 'ghost', x: 1, y: 1 },
        ],
      },
    });
    expect((await t.run((ctx) => ctx.db.get(pipelineId)))?.layout).toEqual({
      nodes: [{ key: 'new', x: 10, y: 20 }],
      arrows: [{ from: 'new', to: 'qualified', x: 5, y: -5 }],
    });
    // Removing a stage drops its node and arrows from the layout too.
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      layout: {
        nodes: [
          { key: 'new', x: 1, y: 1 },
          { key: 'proposal', x: 2, y: 2 },
        ],
        arrows: [{ from: 'proposal', to: 'negotiation', x: 0, y: 0 }],
      },
    });
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      stages: DEFAULT_PIPELINE_STAGES.filter((s) => s.key !== 'proposal'),
    });
    expect((await t.run((ctx) => ctx.db.get(pipelineId)))?.layout).toEqual({
      nodes: [{ key: 'new', x: 1, y: 1 }],
      arrows: [],
    });
    await as.mutation(api.features.deals.mutations.updatePipeline, { pipelineId, layout: null });
    expect((await t.run((ctx) => ctx.db.get(pipelineId)))?.layout).toBeUndefined();
  });

  test('moves follow the graph; without one the default (linear, one step back) applies', async () => {
    const { t, as, pipelineId } = await setup();
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, { title: 'D' });
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: null,
    });
    expect((await t.run((ctx) => ctx.db.get(pipelineId)))?.transitions).toBeUndefined();
    await expect(
      as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'won' }),
    ).rejects.toThrow('deal_transition_forbidden');
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'qualified',
    });
    // One step back is part of the default graph.
    await as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'new' });

    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: linear,
    });
    const [pipeline] = await as.query(api.features.deals.queries.listPipelines, {});
    expect(pipeline.transitions).toEqual(linear);

    await expect(
      as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'proposal' }),
    ).rejects.toThrow('deal_transition_forbidden');
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'qualified',
    });
    await as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'proposal' });
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'negotiation',
    });
    // No going back from « Négociation » to « Qualifiée »…
    await expect(
      as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'qualified' }),
    ).rejects.toThrow('deal_transition_forbidden');
    expect((await dealOf(t, dealId)).stageKey).toBe('negotiation');
    // …until the admin draws the arrow back.
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: [...linear, { from: 'negotiation', to: 'qualified' }],
    });
    await as.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'qualified',
    });
    expect((await dealOf(t, dealId)).stageKey).toBe('qualified');

    // The complete graph is stored explicitly and allows everything.
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: fullTransitions([...DEFAULT_PIPELINE_STAGES]),
    });
    expect((await t.run((ctx) => ctx.db.get(pipelineId)))?.transitions).toHaveLength(28);
    await as.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey: 'won' });
  });

  test('bad arrows are refused; a removed stage drops its arrows', async () => {
    const { t, as, pipelineId } = await setup();
    await expect(
      as.mutation(api.features.deals.mutations.updatePipeline, {
        pipelineId,
        transitions: [{ from: 'won', to: 'lost' }],
      }),
    ).rejects.toThrow('pipeline_transition_from_closed');
    await expect(
      as.mutation(api.features.deals.mutations.updatePipeline, {
        pipelineId,
        transitions: [{ from: 'new', to: 'nope' }],
      }),
    ).rejects.toThrow('pipeline_transition_unknown_stage');

    // Backward arrows are ordinary transitions; warnings (unreachable, dead end) never block the save.
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: linear.filter((t) => !(t.from === 'proposal' && t.to === 'negotiation')),
    });

    // Removing « Proposition » (no deal in it) takes its arrows along and keeps the rest.
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: linear,
    });
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      stages: DEFAULT_PIPELINE_STAGES.filter((s) => s.key !== 'proposal'),
    });
    expect((await t.run((ctx) => ctx.db.get(pipelineId)))?.transitions).toEqual([
      { from: 'new', to: 'qualified' },
      { from: 'negotiation', to: 'won' },
      { from: 'negotiation', to: 'lost' },
    ]);

    // The default graph is stored as absent; the complete one explicitly.
    const stages = DEFAULT_PIPELINE_STAGES.filter((s) => s.key !== 'proposal');
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: defaultTransitions(stages),
    });
    expect((await t.run((ctx) => ctx.db.get(pipelineId)))?.transitions).toBeUndefined();
    await as.mutation(api.features.deals.mutations.updatePipeline, {
      pipelineId,
      transitions: fullTransitions(stages),
    });
    expect((await t.run((ctx) => ctx.db.get(pipelineId)))?.transitions).toHaveLength(3 * 4 + 2 * 3);
  });
});
