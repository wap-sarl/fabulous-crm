import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { DEFAULT_LIFECYCLE_STAGES } from '../../convex/_lib/validators/lifecycle';
import { asIdentity, createTestConvex, seedEmployee, type SeededEmployee, type T } from './helpers';

async function setup(role: 'admin' | 'member' = 'admin') {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role });
  const as = asIdentity(t, emp.identity);
  // updateLifecycleConfig needs a config doc, like every settings mutation.
  await t.run(async (ctx) => {
    await ctx.db.insert('appConfig', {
      organizationName: 'Test',
      appUrl: 'http://localhost:4202',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      updatedAt: Date.now(),
    });
  });
  return { t, emp, as };
}

async function historyOf(t: T, leadId: Id<'leads'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('lifecycleStageHistory')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .collect(),
  );
}

async function allowRegression(as: ReturnType<typeof asIdentity>, allow: boolean) {
  await as.mutation(api.features.config.mutations.updateLifecycleConfig, {
    stages: [...DEFAULT_LIFECYCLE_STAGES],
    defaultStage: 'lead',
    allowRegression: allow,
  });
}

describe('lifecycle stage on leads', () => {
  test('a new lead gets the default stage and an initial history row', async () => {
    const { t, as, emp } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@example.com',
    });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.lifecycleStage).toBe('lead');

    const history = await historyOf(t, leadId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ to: 'lead', source: 'manual', changedBy: emp.userId });
    expect(history[0].from).toBeUndefined();
  });

  test('an explicit unknown stage is rejected at creation', async () => {
    const { as } = await setup();
    await expect(
      as.mutation(api.features.crm.mutations.createLead, {
        firstName: 'A',
        lastName: 'A',
        lifecycleStage: 'nope',
      }),
    ).rejects.toThrow('unknown_lifecycle_stage');
  });

  test('moving forward records the transition; regression is blocked by default', async () => {
    const { t, as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
    });

    await as.mutation(api.features.crm.mutations.updateLead, { leadId, lifecycleStage: 'sql' });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.lifecycleStage).toBe('sql');

    await expect(
      as.mutation(api.features.crm.mutations.updateLead, { leadId, lifecycleStage: 'mql' }),
    ).rejects.toThrow('lifecycle_regression_blocked');
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.lifecycleStage).toBe('sql');

    // Same stage again: a no-op, no extra history row.
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, lifecycleStage: 'sql' });
    const history = await historyOf(t, leadId);
    expect(history.map((h) => [h.from, h.to])).toEqual([
      [undefined, 'lead'],
      ['lead', 'sql'],
    ]);
  });

  test('regression goes through once the rule allows it', async () => {
    const { t, as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      lifecycleStage: 'customer',
    });
    await allowRegression(as, true);
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, lifecycleStage: 'mql' });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.lifecycleStage).toBe('mql');
  });

  test('a stage change dispatches lead_property_changed on lifecycleStage', async () => {
    const { t, as } = await setup();
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Sur changement de cycle',
      trigger: {
        type: 'lead_property_changed',
        watchedFields: [{ kind: 'standard', field: 'lifecycleStage' }],
      },
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
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, lifecycleStage: 'mql' });

    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) => q.eq('workflowId', workflowId).eq('leadId', leadId))
        .collect(),
    );
    expect(runs).toHaveLength(1);
  });
});

describe('CSV import', () => {
  test('inserts with the given stage, upserts only forward, never fails a row on regression', async () => {
    const { t, as } = await setup();
    const first = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        { firstName: 'A', lastName: 'A', email: 'a@example.com', lifecycleStage: 'mql' },
        { firstName: 'B', lastName: 'B', email: 'b@example.com' },
      ],
    });
    expect(first).toMatchObject({ created: 2, updated: 0, errors: [] });

    const second = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        // Regression: silently kept at mql.
        { firstName: 'A', lastName: 'A', email: 'a@example.com', lifecycleStage: 'subscriber' },
        // Forward: applied.
        { firstName: 'B', lastName: 'B', email: 'b@example.com', lifecycleStage: 'customer' },
      ],
    });
    expect(second).toMatchObject({ created: 0, updated: 2, errors: [] });

    const stages = await t.run(async (ctx) => {
      const a = await ctx.db
        .query('leads')
        .withIndex('by_email', (q) => q.eq('email', 'a@example.com'))
        .first();
      const b = await ctx.db
        .query('leads')
        .withIndex('by_email', (q) => q.eq('email', 'b@example.com'))
        .first();
      return [a?.lifecycleStage, b?.lifecycleStage];
    });
    expect(stages).toEqual(['mql', 'customer']);
  });

  test('an unknown stage on a new row is a row error', async () => {
    const { as } = await setup();
    const res = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [{ firstName: 'A', lastName: 'A', email: 'a@example.com', lifecycleStage: 'nope' }],
    });
    expect(res.created).toBe(0);
    expect(res.errors).toEqual([{ index: 0, error: 'unknown_lifecycle_stage' }]);
  });
});

describe('funnel counts and filters', () => {
  test('countLeadsByLifecycleStage follows creations, moves and deletes', async () => {
    const { as } = await setup();
    const a = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
    });
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'B',
      lastName: 'B',
      lifecycleStage: 'customer',
    });
    let counts = await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {});
    expect(counts.byStage.lead).toBe(1);
    expect(counts.byStage.customer).toBe(1);
    expect(counts.unset).toBe(0);

    await as.mutation(api.features.crm.mutations.updateLead, { leadId: a, lifecycleStage: 'sql' });
    counts = await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {});
    expect(counts.byStage.lead).toBe(0);
    expect(counts.byStage.sql).toBe(1);

    await as.mutation(api.features.crm.mutations.deleteLead, { leadId: a });
    counts = await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {});
    expect(counts.byStage.sql).toBe(0);
    expect(counts.byStage.customer).toBe(1);
  });

  test('listLeadsPaginated filters on a single stage via the index and on several in memory', async () => {
    const { as } = await setup();
    for (const [name, stage] of [
      ['A', 'lead'],
      ['B', 'mql'],
      ['C', 'customer'],
    ] as const) {
      await as.mutation(api.features.crm.mutations.createLead, {
        firstName: name,
        lastName: name,
        lifecycleStage: stage,
      });
    }
    const single = await as.query(api.features.crm.queries.listLeadsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
      lifecycleStages: ['mql'],
    });
    expect(single.page.map((l) => l.firstName)).toEqual(['B']);

    const multi = await as.query(api.features.crm.queries.listLeadsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
      lifecycleStages: ['lead', 'customer'],
    });
    expect(multi.page.map((l) => l.firstName).sort()).toEqual(['A', 'C']);
  });

  test('the advanced filter can target lifecycleStage', async () => {
    const { as } = await setup();
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      lifecycleStage: 'sql',
    });
    await as.mutation(api.features.crm.mutations.createLead, { firstName: 'B', lastName: 'B' });
    const res = await as.query(api.features.crm.queries.listLeadsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
      advancedFilter: {
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [
              {
                field: { kind: 'standard', field: 'lifecycleStage' },
                operator: 'equals',
                value: ['sql'],
              },
            ],
          },
        ],
      },
    });
    expect(res.page.map((l) => l.firstName)).toEqual(['A']);
  });
});

describe('workflow step set_lifecycle_stage', () => {
  async function activeWorkflow(t: T, emp: SeededEmployee, stage: string) {
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Qualifier',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'set_lifecycle_stage', stage }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    return workflowId;
  }

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

  test('activation requires a configured stage', async () => {
    const { as } = await setup();
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Incomplet',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: false,
      nodes: [{ id: 'n1', type: 'set_lifecycle_stage', stage: 'nope' }],
      startNodeId: 'n1',
    });
    await expect(
      as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
        workflowId,
        status: 'active',
      }),
    ).rejects.toThrow('statut introuvable');
  });

  test('moves the lead forward and logs the workflow as the actor', async () => {
    const { t, emp, as } = await setup();
    const workflowId = await activeWorkflow(t, emp, 'mql');
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
    });

    const step = await runStep(t, workflowId, leadId);
    expect(step.status).toBe('success');
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.lifecycleStage).toBe('mql');
    const history = await historyOf(t, leadId);
    expect(history.at(-1)).toMatchObject({
      from: 'lead',
      to: 'mql',
      source: 'workflow',
      workflowId,
    });
  });

  test('a blocked regression skips the step without failing the run', async () => {
    const { t, emp, as } = await setup();
    const workflowId = await activeWorkflow(t, emp, 'subscriber');
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      lifecycleStage: 'customer',
    });

    const step = await runStep(t, workflowId, leadId);
    expect(step.status).toBe('skipped');
    expect(step.detail).toBe('retour en arrière interdit');
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.lifecycleStage).toBe('customer');
    const run = await t.run((ctx) => ctx.db.get(step.runId));
    expect(run?.status).toBe('completed');
  });
});

describe('updateLifecycleConfig', () => {
  test('is admin-only and validates the stage list', async () => {
    const { as } = await setup('member');
    await expect(allowRegression(as, true)).rejects.toThrow('Unauthorized');
  });

  test('refuses to remove a stage that still holds leads', async () => {
    const { as } = await setup();
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      lifecycleStage: 'mql',
    });
    await expect(
      as.mutation(api.features.config.mutations.updateLifecycleConfig, {
        stages: DEFAULT_LIFECYCLE_STAGES.filter((s) => s.key !== 'mql'),
        defaultStage: 'lead',
        allowRegression: false,
      }),
    ).rejects.toThrow('lifecycle_stage_in_use');

    // An empty stage can go; the default must remain a listed stage.
    await as.mutation(api.features.config.mutations.updateLifecycleConfig, {
      stages: DEFAULT_LIFECYCLE_STAGES.filter((s) => s.key !== 'evangelist'),
      defaultStage: 'lead',
      allowRegression: false,
    });
    await expect(
      as.mutation(api.features.config.mutations.updateLifecycleConfig, {
        stages: [{ key: 'lead', label: 'Lead' }],
        defaultStage: 'mql',
        allowRegression: false,
      }),
    ).rejects.toThrow('lifecycle_invalid_default');

    const config = await as.query(api.features.config.queries.getLifecycleConfig, {});
    expect(config.stages.map((s) => s.key)).not.toContain('evangelist');
  });
});
