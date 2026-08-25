import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { MAX_STEPS_PER_RUN } from '../../convex/features/workflows/lib';
import {
  asIdentity,
  createTestConvex,
  seedEmployee,
  seedLead,
  type SeededEmployee,
  type T,
} from './helpers';

async function setup(): Promise<{ t: T; emp: SeededEmployee }> {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  return { t, emp };
}

const waitNode = (id: string, next?: string) => ({
  id,
  type: 'wait' as const,
  amount: 1,
  unit: 'hours' as const,
  next,
});

describe('graph validation', () => {
  test('creation rejects a graph above MAX_NODES', async () => {
    const { t, emp } = await setup();
    const nodes = Array.from({ length: 51 }, (_, i) =>
      waitNode(`n${i}`, i < 50 ? `n${i + 1}` : undefined),
    );
    await expect(
      asIdentity(t, emp.identity).mutation(api.features.workflows.mutations.createWorkflow, {
        name: 'Trop grand',
        trigger: { type: 'consent_updated' },
        allowReEnrollment: false,
        nodes,
        startNodeId: 'n0',
      }),
    ).rejects.toThrow('Un workflow est limité à 50 étapes.');
  });

  test('activation rejects a cyclic graph (a draft may hold it, activation may not)', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Cycle',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: false,
      nodes: [waitNode('n1', 'n2'), waitNode('n2', 'n1')],
      startNodeId: 'n1',
    });
    await expect(
      as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
        workflowId,
        status: 'active',
      }),
    ).rejects.toThrow('Le graphe contient un cycle ou une étape atteinte par deux chemins.');
  });

  test('activation rejects orphan nodes not linked to the path', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Orphelin',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: false,
      nodes: [waitNode('n1'), waitNode('orphan')],
      startNodeId: 'n1',
    });
    await expect(
      as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
        workflowId,
        status: 'active',
      }),
    ).rejects.toThrow('Certaines étapes ne sont pas reliées au parcours.');
  });
});

describe('enrollment', () => {
  /** Active workflow enrolling on consent_updated, with a single wait node. */
  async function createActiveWorkflow(
    t: T,
    emp: SeededEmployee,
    opts?: { allowReEnrollment?: boolean },
  ): Promise<Id<'workflows'>> {
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Enrôlement',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: opts?.allowReEnrollment ?? true,
      nodes: [waitNode('n1')],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    return workflowId;
  }

  async function fireConsentUpdated(t: T, token: string): Promise<void> {
    await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token,
      channels: ['email'],
    });
  }

  /** Mark every run of the workflow finished, freeing the lead for re-enrollment. */
  async function completeAllRuns(t: T, workflowId: Id<'workflows'>): Promise<void> {
    await t.run(async (ctx) => {
      const runs = await ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
        .collect();
      for (const run of runs) {
        if (run.status === 'active') {
          await ctx.db.patch(run._id, { status: 'completed', finishedAt: Date.now() });
        }
      }
    });
  }

  test('a matching trigger enrolls the lead once; an active run blocks re-enrollment', async () => {
    const { t, emp } = await setup();
    const workflowId = await createActiveWorkflow(t, emp);
    const leadId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createLead,
      { firstName: 'W', lastName: 'F', email: 'wf@example.com' },
    );
    const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken ?? '';

    await fireConsentUpdated(t, token);
    await fireConsentUpdated(t, token); // second event while the run is active

    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
        .collect(),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ leadId, status: 'active', triggerType: 'consent_updated' });
  });

  test('MAX_ENROLLMENTS_PER_LEAD_PER_DAY caps at 5 even with re-enrollment allowed', async () => {
    const { t, emp } = await setup();
    const workflowId = await createActiveWorkflow(t, emp, { allowReEnrollment: true });
    const leadId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createLead,
      { firstName: 'Cap', lastName: 'Lead', email: 'cap@example.com' },
    );
    const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken ?? '';

    for (let i = 0; i < 7; i++) {
      await fireConsentUpdated(t, token);
      await completeAllRuns(t, workflowId); // free the active-run slot each time
    }

    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
        .collect(),
    );
    expect(runs).toHaveLength(5);
  });

  test('allowReEnrollment: false blocks any second run even after completion', async () => {
    const { t, emp } = await setup();
    const workflowId = await createActiveWorkflow(t, emp, { allowReEnrollment: false });
    const leadId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createLead,
      { firstName: 'Once', lastName: 'Only', email: 'once@example.com' },
    );
    const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken ?? '';

    await fireConsentUpdated(t, token);
    await completeAllRuns(t, workflowId);
    await fireConsentUpdated(t, token);

    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
        .collect(),
    );
    expect(runs).toHaveLength(1);
  });
});

describe('run execution guards', () => {
  test('executeStep fails the run at MAX_STEPS_PER_RUN', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Boucle',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [waitNode('n1')],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Step',
      lastName: 'Limit',
      email: 'steps@example.com',
    });

    // A run already at the cap: the next step must fail it, not execute it.
    const runId = await t.run((ctx) =>
      ctx.db.insert('workflowRuns', {
        workflowId,
        leadId,
        status: 'active',
        triggerType: 'consent_updated',
        enrolledAt: Date.now(),
        currentNodeId: 'n1',
        stepCount: MAX_STEPS_PER_RUN,
      }),
    );
    await t.mutation(internal.features.workflows.internal.executeStep, { runId, nodeId: 'n1' });

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('step_limit');
  });
});

describe('bulk re-enroll (batched)', () => {
  const REENROLL_BATCH = 100;

  async function createActiveWorkflow(t: T, emp: SeededEmployee): Promise<Id<'workflows'>> {
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Bulk',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait' as const, amount: 1, unit: 'hours' as const }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    return workflowId;
  }

  /** Drive the reenroll chain to completion, batch by batch (deterministic). */
  async function runReenroll(t: T, workflowId: Id<'workflows'>): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const res = await t.mutation(internal.features.workflows.internal.reenrollBatch, {
        workflowId,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      if (res.isDone) return;
      cursor = res.continueCursor ?? undefined;
    }
  }

  test('starts in running state, enrolls across batches, finishes with final counts', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const workflowId = await createActiveWorkflow(t, emp);
    // One more lead than a batch, to force a second page.
    for (let i = 0; i < REENROLL_BATCH + 1; i++) {
      await seedLead(t, { email: `bulk-${i}@example.com` });
    }

    await as.mutation(api.features.workflows.mutations.reenrollMatchingLeads, { workflowId });
    let workflow = await t.run((ctx) => ctx.db.get(workflowId));
    expect(workflow?.bulkReenroll?.status).toBe('running');
    // A second start while running is refused.
    await expect(
      as.mutation(api.features.workflows.mutations.reenrollMatchingLeads, { workflowId }),
    ).rejects.toThrow('déjà en cours');

    await runReenroll(t, workflowId);

    workflow = await t.run((ctx) => ctx.db.get(workflowId));
    expect(workflow?.bulkReenroll?.status).toBe('done');
    expect(workflow?.bulkReenroll?.matched).toBe(REENROLL_BATCH + 1);
    expect(workflow?.bulkReenroll?.enrolled).toBe(REENROLL_BATCH + 1);
    expect(workflow?.bulkReenroll?.cancelled).toBe(0);
    expect(workflow?.activeCount).toBe(REENROLL_BATCH + 1);
    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
        .collect(),
    );
    expect(runs).toHaveLength(REENROLL_BATCH + 1);
    expect(runs.every((r) => r.status === 'active' && r.triggerType === 'bulk_reenroll')).toBe(
      true,
    );
  });

  test('cancels in-flight runs before re-enrolling, and fixes activeCount', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const workflowId = await createActiveWorkflow(t, emp);
    const leadId = await seedLead(t, { email: 'inflight@example.com' });
    await as.mutation(api.features.workflows.mutations.enrollLeadManually, { workflowId, leadId });

    await as.mutation(api.features.workflows.mutations.reenrollMatchingLeads, { workflowId });
    await runReenroll(t, workflowId);

    const workflow = await t.run((ctx) => ctx.db.get(workflowId));
    expect(workflow?.bulkReenroll?.cancelled).toBe(1);
    expect(workflow?.bulkReenroll?.enrolled).toBe(1);
    expect(workflow?.activeCount).toBe(1);
    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) => q.eq('workflowId', workflowId).eq('leadId', leadId))
        .collect(),
    );
    expect(runs.map((r) => r.status).sort()).toEqual(['active', 'cancelled']);
  });

  test('a lead at the daily cap is skipped and keeps its in-flight run', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const workflowId = await createActiveWorkflow(t, emp);
    const capped = await seedLead(t, { email: 'capped@example.com' });
    const free = await seedLead(t, { email: 'free@example.com' });
    // 5 enrollments today: 4 finished + 1 still active.
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert('workflowRuns', {
          workflowId,
          leadId: capped,
          status: i === 0 ? 'active' : 'completed',
          triggerType: 'consent_updated',
          enrolledAt: Date.now(),
          currentNodeId: i === 0 ? 'n1' : undefined,
          stepCount: 0,
        });
      }
    });

    await as.mutation(api.features.workflows.mutations.reenrollMatchingLeads, { workflowId });
    await runReenroll(t, workflowId);

    const workflow = await t.run((ctx) => ctx.db.get(workflowId));
    expect(workflow?.bulkReenroll?.skipped).toBe(1);
    expect(workflow?.bulkReenroll?.enrolled).toBe(1); // only the free lead
    const cappedRuns = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) => q.eq('workflowId', workflowId).eq('leadId', capped))
        .collect(),
    );
    // Untouched: the active run survived, nothing new was added.
    expect(cappedRuns).toHaveLength(5);
    expect(cappedRuns.filter((r) => r.status === 'active')).toHaveLength(1);
    const freeRuns = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) => q.eq('workflowId', workflowId).eq('leadId', free))
        .collect(),
    );
    expect(freeRuns).toHaveLength(1);
  });

  test('enrollment criteria restrict who is re-enrolled', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Criteres',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      enrollmentCriteria: {
        combinator: 'and' as const,
        groups: [
          {
            combinator: 'and' as const,
            rules: [
              {
                field: { kind: 'standard' as const, field: 'lifecycleStage' as const },
                operator: 'equals' as const,
                value: 'customer',
              },
            ],
          },
        ],
      },
      nodes: [{ id: 'n1', type: 'wait' as const, amount: 1, unit: 'hours' as const }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    const converted = await seedLead(t, { email: 'oui@example.com', lifecycleStage: 'customer' });
    await seedLead(t, { email: 'non@example.com', lifecycleStage: 'lead' });

    await as.mutation(api.features.workflows.mutations.reenrollMatchingLeads, { workflowId });
    await runReenroll(t, workflowId);

    const workflow = await t.run((ctx) => ctx.db.get(workflowId));
    expect(workflow?.bulkReenroll?.matched).toBe(1);
    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
        .collect(),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.leadId).toBe(converted);
  });
});
