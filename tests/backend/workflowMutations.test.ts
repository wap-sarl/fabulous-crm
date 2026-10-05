import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { WorkflowNode } from '../../convex/_lib/validators/workflows';
import { countDb } from '../support/dbCounter';
import { asIdentity, createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const HOUR_MS = 60 * 60 * 1000;
const fn = api.features.workflows.mutations;

type World = { t: T; as: ReturnType<typeof asIdentity>; userId: Id<'users'> };

async function setup(): Promise<World> {
  const t = createTestConvex();
  pinClock(NOW);
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  return { t, as: asIdentity(t, emp.identity), userId: emp.userId };
}

const wait = (id: string, next?: string): WorkflowNode => ({
  id,
  type: 'wait',
  amount: 1,
  unit: 'hours',
  next,
});

const draft = (nodes: WorkflowNode[] = [wait('n1')]) => ({
  name: 'Relance',
  trigger: { type: 'consent_updated' as const },
  allowReEnrollment: true,
  nodes,
  startNodeId: nodes[0]?.id,
});

/** A workflow created and brought to `status` through the mutations. */
async function workflowIn(w: World, status: 'draft' | 'active' | 'paused') {
  const workflowId = await w.as.mutation(fn.createWorkflow, draft());
  if (status !== 'draft')
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'active' });
  if (status === 'paused')
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'paused' });
  return workflowId;
}

let leadNumber = 0;
const createLead = (w: World) =>
  w.as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Jean',
    lastName: 'Dupont',
    email: `jean${++leadNumber}@example.com`,
  });

/** A run written as the engine leaves it; with `sleeping`, parked on a wait with its wake scheduled. */
async function insertRun(
  w: World,
  workflowId: Id<'workflows'>,
  overrides: Partial<Doc<'workflowRuns'>> = {},
  sleeping = false,
) {
  const leadId = await createLead(w);
  return await w.t.run(async (ctx) => {
    const runId = await ctx.db.insert('workflowRuns', {
      workflowId,
      leadId,
      status: 'active',
      triggerType: 'manual',
      enrolledAt: NOW,
      currentNodeId: 'n1',
      stepCount: 0,
      ...overrides,
    });
    if (sleeping) {
      const wakeAt = NOW + HOUR_MS;
      const scheduledFnId = await ctx.scheduler.runAt(
        wakeAt,
        internal.features.workflows.internal.executeStep,
        { runId, nodeId: 'n1' },
      );
      await ctx.db.patch(runId, { wakeAt, scheduledFnId });
    }
    const workflow = await ctx.db.get(workflowId);
    if (workflow && (overrides.status ?? 'active') === 'active') {
      await ctx.db.patch(workflowId, {
        activeCount: workflow.activeCount + 1,
        enrolledCount: workflow.enrolledCount + 1,
      });
    }
    return runId;
  });
}

const get = <Table extends 'workflows' | 'workflowRuns'>(w: World, id: Id<Table>) =>
  w.t.run(async (ctx) => (await ctx.db.get(id)) as Doc<Table>);

/** The scheduled calls of `executeStep` for a run, with their state. */
const wakesOf = (w: World, runId: Id<'workflowRuns'>) =>
  w.t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => (job.args[0] as { runId?: string })?.runId === runId)
      .map((job) => ({ state: job.state.kind, at: job.scheduledTime })),
  );

const auditsOf = (w: World, entityId: string) =>
  w.t.run(async (ctx) =>
    (await ctx.db.query('auditLogs').collect())
      .filter((a) => a.entityId === entityId)
      .map((a) => ({ action: a.action, userId: a.userId, metadata: a.metadata })),
  );

const CANCELLED = { status: 'cancelled', finishedAt: NOW };

function expectStopped(run: Doc<'workflowRuns'>) {
  expect(run).toMatchObject(CANCELLED);
  expect(run.currentNodeId).toBeUndefined();
  expect(run.wakeAt).toBeUndefined();
  expect(run.scheduledFnId).toBeUndefined();
  expect(run.error).toBeUndefined();
}

describe('workflows: editing', () => {
  test('an edit replaces the draft and is audited with what changed; no change, no audit', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'draft');
    const edited = {
      ...draft([wait('n1', 'n2'), wait('n2')]),
      name: ' Relance 2 ',
      description: 'x',
    };

    expect(await w.as.mutation(fn.updateWorkflow, { workflowId, ...edited })).toBe(workflowId);
    const workflow = await get(w, workflowId);
    expect(workflow).toMatchObject({ name: 'Relance 2', description: 'x', updatedBy: w.userId });
    expect(workflow.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    const updates = (await auditsOf(w, workflowId)).filter((a) => a.action === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].userId).toBe(w.userId);
    expect(Object.keys((updates[0].metadata as { changes: object }).changes).sort()).toEqual([
      'description',
      'name',
      'nodes',
    ]);

    await w.as.mutation(fn.updateWorkflow, { workflowId, ...edited, name: 'Relance 2' });
    expect((await auditsOf(w, workflowId)).filter((a) => a.action === 'update')).toHaveLength(1);
  });

  test('an active workflow takes a new name, not a new graph; a paused one takes both', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'active');
    await w.as.mutation(fn.updateWorkflow, { workflowId, ...draft(), name: 'Autre nom' });
    expect((await get(w, workflowId)).name).toBe('Autre nom');

    const structural = [
      { nodes: [wait('n1', 'n2'), wait('n2')] },
      { allowReEnrollment: false },
      { trigger: { type: 'lead_created' as const } },
      { startNodeId: 'other' },
      { enrollmentCriteria: { combinator: 'and' as const, groups: [] } },
    ];
    for (const change of structural) {
      await expect(
        w.as.mutation(fn.updateWorkflow, { workflowId, ...draft(), ...change }),
      ).rejects.toThrow('Mettez le workflow en pause avant de le modifier.');
    }
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'paused' });
    await w.as.mutation(fn.updateWorkflow, { workflowId, ...draft(), allowReEnrollment: false });
    expect((await get(w, workflowId)).allowReEnrollment).toBe(false);
  });

  test('an edit is refused without a name, with a graph that does not hold together, or on a deleted workflow', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'draft');
    await expect(
      w.as.mutation(fn.updateWorkflow, { workflowId, ...draft(), name: '  ' }),
    ).rejects.toThrow('Le nom du workflow est requis.');
    await expect(
      w.as.mutation(fn.updateWorkflow, { workflowId, ...draft([wait('n1'), wait('n1')]) }),
    ).rejects.toThrow("Identifiant d'étape en double : n1.");
    await expect(
      w.as.mutation(fn.updateWorkflow, { workflowId, ...draft([wait('n1', 'gone')]) }),
    ).rejects.toThrow('Une étape référence une étape introuvable (gone).');
    await w.as.mutation(fn.deleteWorkflow, { workflowId });
    await expect(w.as.mutation(fn.updateWorkflow, { workflowId, ...draft() })).rejects.toThrow(
      'workflow_not_found',
    );
  });
});

describe('workflows: an edit that clears', () => {
  const criteria = {
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
  };

  test('an active workflow cannot lose its first step or its criteria: a cleared field is a change like another', async () => {
    const w = await setup();
    const full = { ...draft(), description: 'Relance des clients', enrollmentCriteria: criteria };
    const workflowId = await w.as.mutation(fn.createWorkflow, full);
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'active' });

    for (const cleared of ['startNodeId', 'enrollmentCriteria'] as const) {
      const { [cleared]: _dropped, ...rest } = full;
      await expect(w.as.mutation(fn.updateWorkflow, { workflowId, ...rest })).rejects.toMatchObject(
        {
          data: { code: 'workflow_pause_first' },
        },
      );
    }
    expect(await get(w, workflowId)).toMatchObject({
      startNodeId: 'n1',
      enrollmentCriteria: criteria,
    });

    // The description is not structural: it can be cleared while the workflow runs, and the journal says so.
    const { description: _description, ...withoutDescription } = full;
    await w.as.mutation(fn.updateWorkflow, { workflowId, ...withoutDescription });
    expect((await get(w, workflowId)).description).toBeUndefined();
    expect((await auditsOf(w, workflowId)).at(-1)).toMatchObject({
      action: 'update',
      metadata: { changes: { description: { old: 'Relance des clients', new: null } } },
    });
  });

  test('a paused workflow can lose them, and the journal says what was cleared', async () => {
    const w = await setup();
    const full = { ...draft(), enrollmentCriteria: criteria };
    const workflowId = await w.as.mutation(fn.createWorkflow, full);
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'active' });
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'paused' });

    const { startNodeId: _start, enrollmentCriteria: _criteria, ...bare } = full;
    await w.as.mutation(fn.updateWorkflow, { workflowId, ...bare });
    const workflow = await get(w, workflowId);
    expect(workflow.startNodeId).toBeUndefined();
    expect(workflow.enrollmentCriteria).toBeUndefined();
    expect((await auditsOf(w, workflowId)).at(-1)?.metadata).toEqual({
      changes: {
        startNodeId: { old: 'n1', new: null },
        enrollmentCriteria: { old: criteria, new: null },
      },
    });
  });
});

describe('workflows: pause and resume', () => {
  test('a pause and an activation are audited; the status it already has changes nothing', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'active');
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'active' });
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'paused' });
    expect((await get(w, workflowId)).status).toBe('paused');
    const events = (await auditsOf(w, workflowId))
      .filter((a) => a.action === 'update')
      .map((a) => (a.metadata as { event: string }).event);
    expect(events).toEqual(['activate', 'pause']);
  });

  test('a resume kicks the runs the pause parked, and leaves a run that sleeps to its wake', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'paused');
    const parked = await insertRun(w, workflowId);
    const overdue = await insertRun(w, workflowId, { wakeAt: NOW - 1 });
    const sleeping = await insertRun(w, workflowId, {}, true);
    const pointless = await insertRun(w, workflowId, { currentNodeId: undefined });
    const done = await insertRun(w, workflowId, { status: 'completed' });

    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'active' });
    expect(await wakesOf(w, parked)).toEqual([{ state: 'pending', at: NOW }]);
    expect(await wakesOf(w, overdue)).toEqual([{ state: 'pending', at: NOW }]);
    expect(await wakesOf(w, sleeping)).toEqual([{ state: 'pending', at: NOW + HOUR_MS }]);
    expect(await wakesOf(w, pointless)).toEqual([]);
    expect(await wakesOf(w, done)).toEqual([]);
  });

  test('a first activation kicks nothing', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'draft');
    const runId = await insertRun(w, workflowId);
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'active' });
    expect(await wakesOf(w, runId)).toEqual([]);
  });
});

describe('workflows: rules tightened after a workflow was activated', () => {
  test('the active and paused workflows the activation would refuse are listed; they keep running, and cannot be resumed once paused', async () => {
    const w = await setup();
    // As an older version left them: valid when activated, at fault under the rules of today.
    const longWait = await workflowIn(w, 'active');
    const emptyMail = await workflowIn(w, 'paused');
    const fine = await workflowIn(w, 'active');
    const gone = await workflowIn(w, 'active');
    const draftAtFault = await workflowIn(w, 'draft');
    await w.t.run(async (ctx) => {
      await ctx.db.patch(longWait, {
        name: 'Longue attente',
        nodes: [{ id: 'n1', type: 'wait', amount: 90 * 24 + 1, unit: 'hours' }],
      });
      const mail = {
        id: 'n1',
        type: 'send_email' as const,
        subject: 'Bonjour',
        htmlBody: '<p></p>',
      };
      await ctx.db.patch(emptyMail, { name: 'Message vide', nodes: [mail] });
      await ctx.db.patch(gone, { nodes: [mail], deletedAt: NOW });
      await ctx.db.patch(draftAtFault, { nodes: [mail] });
    });

    expect(await w.t.query(internal.features.workflows.internal.listWorkflowsToFix, {})).toEqual([
      {
        workflowId: longWait,
        name: 'Longue attente',
        status: 'active',
        issue: 'Étape « Attendre » : durée maximale 90 jours.',
      },
      {
        workflowId: emptyMail,
        name: 'Message vide',
        status: 'paused',
        issue: 'Étape « Envoyer un e-mail » : le contenu est requis.',
      },
    ]);
    expect((await get(w, fine)).status).toBe('active');

    await expect(
      w.as.mutation(fn.setWorkflowStatus, { workflowId: emptyMail, status: 'active' }),
    ).rejects.toMatchObject({
      data: {
        code: 'workflow_graph_invalid',
        message: 'Étape « Envoyer un e-mail » : le contenu est requis.',
      },
    });
    // The one at fault and active is left running; pausing it is what makes the fix compulsory.
    expect((await get(w, longWait)).status).toBe('active');
    await w.as.mutation(fn.setWorkflowStatus, { workflowId: longWait, status: 'paused' });
    await expect(
      w.as.mutation(fn.setWorkflowStatus, { workflowId: longWait, status: 'active' }),
    ).rejects.toMatchObject({ data: { code: 'workflow_graph_invalid' } });
  });
});

describe('workflows: the end of a run before its path', () => {
  test('deleting a workflow needs a pause, cancels its runs with their wake, and keeps the finished ones', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'active');
    const parked = await insertRun(w, workflowId);
    const sleeping = await insertRun(w, workflowId, {}, true);
    const done = await insertRun(w, workflowId, { status: 'completed', finishedAt: NOW - 5 });

    await expect(w.as.mutation(fn.deleteWorkflow, { workflowId })).rejects.toThrow(
      'Mettez le workflow en pause avant de le supprimer.',
    );
    expect((await get(w, parked)).status).toBe('active');

    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'paused' });
    await w.as.mutation(fn.deleteWorkflow, { workflowId });
    expectStopped(await get(w, parked));
    expectStopped(await get(w, sleeping));
    expect(await wakesOf(w, sleeping)).toEqual([{ state: 'canceled', at: NOW + HOUR_MS }]);
    expect(await get(w, done)).toMatchObject({ status: 'completed', finishedAt: NOW - 5 });
    expect(await get(w, workflowId)).toMatchObject({
      deletedAt: NOW,
      activeCount: 0,
      enrolledCount: 2,
      updatedBy: w.userId,
    });
    expect((await auditsOf(w, workflowId)).at(-1)).toMatchObject({
      action: 'delete',
      userId: w.userId,
    });
    await expect(w.as.mutation(fn.deleteWorkflow, { workflowId })).rejects.toThrow(
      'workflow_not_found',
    );
  });

  test('cancelling a run stops it with its wake, gives its place back and is audited', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'active');
    const sleeping = await insertRun(w, workflowId, {}, true);
    const other = await insertRun(w, workflowId);
    expect((await get(w, workflowId)).activeCount).toBe(2);

    await w.as.mutation(fn.cancelRun, { runId: sleeping });
    expectStopped(await get(w, sleeping));
    expect(await wakesOf(w, sleeping)).toEqual([{ state: 'canceled', at: NOW + HOUR_MS }]);
    expect((await get(w, other)).status).toBe('active');
    expect(await get(w, workflowId)).toMatchObject({ activeCount: 1, enrolledCount: 2 });
    expect(await auditsOf(w, sleeping)).toEqual([
      { action: 'update', userId: w.userId, metadata: { event: 'cancel' } },
    ]);

    await expect(w.as.mutation(fn.cancelRun, { runId: sleeping })).rejects.toThrow(
      'Ce parcours est déjà terminé.',
    );
    expect((await get(w, workflowId)).activeCount).toBe(1);
  });

  test('cancelling a run never takes the counter below zero, and a run that is gone is refused', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'active');
    const runId = await insertRun(w, workflowId);
    await w.t.run((ctx) => ctx.db.patch(workflowId, { activeCount: 0 }));
    await w.as.mutation(fn.cancelRun, { runId });
    expect((await get(w, workflowId)).activeCount).toBe(0);
    expectStopped(await get(w, runId));

    await w.t.run((ctx) => ctx.db.delete(runId));
    await expect(w.as.mutation(fn.cancelRun, { runId })).rejects.toThrow('run_not_found');
  });

  test('a re-enrollment cancels the run in flight with its wake before it starts another', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'active');
    const sleeping = await insertRun(w, workflowId, {}, true);
    const leadId = (await get(w, sleeping)).leadId;
    const done = await insertRun(w, workflowId, { status: 'completed', finishedAt: NOW - 5 });

    await w.as.mutation(fn.reenrollMatchingLeads, { workflowId });
    await w.t.mutation(internal.features.workflows.internal.reenrollBatch, { workflowId });
    // A run that is over is left as it ended.
    expect(await get(w, done)).toMatchObject({ status: 'completed', finishedAt: NOW - 5 });
    expectStopped(await get(w, sleeping));
    expect(await wakesOf(w, sleeping)).toEqual([{ state: 'canceled', at: NOW + HOUR_MS }]);
    const runs = await w.t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) => q.eq('workflowId', workflowId).eq('leadId', leadId))
        .collect(),
    );
    expect(runs.map((r) => r.status).sort()).toEqual(['active', 'cancelled']);
    expect(await get(w, workflowId)).toMatchObject({
      activeCount: 2,
      bulkReenroll: { status: 'done', matched: 2, enrolled: 2, cancelled: 1, skipped: 0 },
    });
  });
});

describe('workflows: more runs than one transaction takes', () => {
  /** `count` runs of one lead, parked on the first step, as a pause leaves them; every third sleeps on a wake. */
  async function insertRuns(w: World, workflowId: Id<'workflows'>, count: number) {
    const leadId = await createLead(w);
    return await w.t.run(async (ctx) => {
      const ids: Id<'workflowRuns'>[] = [];
      for (let i = 0; i < count; i++) {
        const runId = await ctx.db.insert('workflowRuns', {
          workflowId,
          leadId,
          status: 'active',
          triggerType: 'manual',
          enrolledAt: NOW,
          currentNodeId: 'n1',
          stepCount: 0,
        });
        if (i % 3 === 0) {
          const scheduledFnId = await ctx.scheduler.runAt(
            NOW + HOUR_MS,
            internal.features.workflows.internal.executeStep,
            { runId, nodeId: 'n1' },
          );
          await ctx.db.patch(runId, { wakeAt: NOW + HOUR_MS, scheduledFnId });
        }
        ids.push(runId);
      }
      await ctx.db.patch(workflowId, { activeCount: count, enrolledCount: count });
      return ids;
    });
  }
  const runsOf = (w: World, workflowId: Id<'workflows'>) =>
    w.t.run(async (ctx) =>
      (await ctx.db.query('workflowRuns').collect()).filter((r) => r.workflowId === workflowId),
    );
  /** The calls of an internal function of the workflows that were scheduled, with what each was given. */
  const scheduled = (w: World, name: string) =>
    w.t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect())
        .filter((job) => job.name.endsWith(name))
        .map((job) => job.args[0] as unknown as { workflowId: Id<'workflows'>; cursor: string }),
    );
  const stopped = (runs: Doc<'workflowRuns'>[]) =>
    runs.filter(
      (r) => r.status === 'cancelled' && !r.currentNodeId && !r.wakeAt && !r.scheduledFnId,
    );
  const rest = internal.features.workflows.internal;

  // The scheduled calls are made here by hand, one after the other, as the scheduler makes them.
  test('deleting a workflow stops a batch of its runs at once, and schedules the rest batch by batch', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'paused');
    await insertRuns(w, workflowId, 450);

    const cost = await countDb(() => w.as.mutation(fn.deleteWorkflow, { workflowId }));
    // Each run of the batch is read, then read again by the write that stops it.
    expect(cost.reads.workflowRuns).toBe(400);
    expect(await get(w, workflowId)).toMatchObject({ deletedAt: NOW, activeCount: 0 });
    expect(stopped(await runsOf(w, workflowId))).toHaveLength(200);
    expect(await scheduled(w, 'stopRemainingRuns')).toMatchObject([{ workflowId }]);

    await w.t.mutation(rest.stopRemainingRuns, { workflowId });
    expect(stopped(await runsOf(w, workflowId))).toHaveLength(400);
    expect(await scheduled(w, 'stopRemainingRuns')).toHaveLength(2);

    // The last batch is not full: nothing is scheduled after it.
    await w.t.mutation(rest.stopRemainingRuns, { workflowId });
    expect(stopped(await runsOf(w, workflowId))).toHaveLength(450);
    expect(await scheduled(w, 'stopRemainingRuns')).toHaveLength(2);
    expect((await get(w, workflowId)).activeCount).toBe(0);
  });

  test('a resume kicks a batch of the parked runs at once, and schedules the rest batch by batch', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'paused');
    await insertRuns(w, workflowId, 450);
    // A run that sleeps keeps its wake and gets no kick: 150 wakes before, and a kick for each of the others after.
    const kicks = async () => (await scheduled(w, 'executeStep')).length - 150;

    const cost = await countDb(() =>
      w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'active' }),
    );
    expect(cost.reads.workflowRuns).toBe(200);
    expect(await kicks()).toBe(133);
    const [second] = await scheduled(w, 'resumeParkedRuns');
    expect(second.workflowId).toBe(workflowId);
    expect(typeof second.cursor).toBe('string');

    await w.t.mutation(rest.resumeParkedRuns, second);
    expect(await kicks()).toBe(266);
    const [, third] = await scheduled(w, 'resumeParkedRuns');
    expect(third.cursor).not.toBe(second.cursor);

    // The last batch ends the chain; every parked run had its kick, once.
    await w.t.mutation(rest.resumeParkedRuns, third);
    expect(await kicks()).toBe(300);
    expect(await scheduled(w, 'resumeParkedRuns')).toHaveLength(2);
    const kicked = (await scheduled(w, 'executeStep')) as unknown as { runId: string }[];
    expect(new Set(kicked.map((job) => job.runId)).size).toBe(450);
  });

  test('a workflow paused again, or deleted, before the rest is resumed keeps the rest parked', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'paused');
    await insertRuns(w, workflowId, 450);
    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'active' });
    const [second] = await scheduled(w, 'resumeParkedRuns');
    const calls = async () => (await scheduled(w, 'executeStep')).length;
    const before = await calls();

    await w.as.mutation(fn.setWorkflowStatus, { workflowId, status: 'paused' });
    await w.t.mutation(rest.resumeParkedRuns, second);
    expect(await calls()).toBe(before);
    expect(await scheduled(w, 'resumeParkedRuns')).toHaveLength(1);

    await w.t.run((ctx) => ctx.db.patch(workflowId, { status: 'active', deletedAt: NOW }));
    await w.t.mutation(rest.resumeParkedRuns, second);
    expect(await calls()).toBe(before);
  });
});

describe('workflows: enrolling by hand and in bulk', () => {
  test('a re-enrollment needs an active workflow and runs one at a time', async () => {
    const w = await setup();
    const paused = await workflowIn(w, 'paused');
    await expect(w.as.mutation(fn.reenrollMatchingLeads, { workflowId: paused })).rejects.toThrow(
      'Activez le workflow avant de réinscrire des leads.',
    );
    const workflowId = await workflowIn(w, 'active');
    await w.as.mutation(fn.reenrollMatchingLeads, { workflowId });
    expect((await get(w, workflowId)).bulkReenroll).toMatchObject({
      status: 'running',
      startedBy: w.userId,
      startedAt: NOW,
      matched: 0,
    });
    await expect(w.as.mutation(fn.reenrollMatchingLeads, { workflowId })).rejects.toThrow(
      'Une réinscription est déjà en cours pour ce workflow.',
    );
    const jobs = await w.t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect())
        .filter((job) => job.name.includes('reenrollBatch'))
        .map((job) => job.args[0]),
    );
    expect(jobs).toEqual([{ workflowId }]);

    const empty = await workflowIn(w, 'active');
    await w.t.run((ctx) => ctx.db.patch(empty, { startNodeId: undefined }));
    await expect(w.as.mutation(fn.reenrollMatchingLeads, { workflowId: empty })).rejects.toThrow(
      'Activez le workflow avant de réinscrire des leads.',
    );
  });

  test('enrolling a contact by hand needs an active workflow and no run in flight', async () => {
    const w = await setup();
    const leadId = await createLead(w);
    const paused = await workflowIn(w, 'paused');
    await expect(
      w.as.mutation(fn.enrollLeadManually, { workflowId: paused, leadId }),
    ).rejects.toThrow('Activez le workflow avant d’inscrire un lead.');

    const workflowId = await workflowIn(w, 'active');
    const runId = await w.as.mutation(fn.enrollLeadManually, { workflowId, leadId });
    expect(await get(w, runId)).toMatchObject({
      status: 'active',
      manual: true,
      triggerType: 'manual',
    });
    expect(await auditsOf(w, runId)).toEqual([
      {
        action: 'create',
        userId: w.userId,
        metadata: { event: 'manual_enroll', workflowId, leadId },
      },
    ]);
    await expect(w.as.mutation(fn.enrollLeadManually, { workflowId, leadId })).rejects.toThrow(
      'Ce lead a déjà un parcours en cours dans ce workflow.',
    );
  });

  test('enrolling by hand is refused for a deleted contact, a second time when re-enrollment is off, and without a first step', async () => {
    const w = await setup();
    const workflowId = await workflowIn(w, 'active');
    const deleted = await createLead(w);
    await w.t.run((ctx) => ctx.db.patch(deleted, { deletedAt: NOW }));
    await expect(
      w.as.mutation(fn.enrollLeadManually, { workflowId, leadId: deleted }),
    ).rejects.toThrow('lead_not_found');

    const once = await workflowIn(w, 'active');
    await w.t.run((ctx) => ctx.db.patch(once, { allowReEnrollment: false }));
    const past = await insertRun(w, once, { status: 'completed', finishedAt: NOW - 5 });
    const { leadId } = await get(w, past);
    await expect(
      w.as.mutation(fn.enrollLeadManually, { workflowId: once, leadId }),
    ).rejects.toThrow('Ce lead a déjà été inscrit dans ce workflow (réinscription désactivée).');
    // With re-enrollment on, a finished run is no obstacle.
    await w.t.run((ctx) => ctx.db.patch(once, { allowReEnrollment: true }));
    await w.as.mutation(fn.enrollLeadManually, { workflowId: once, leadId });

    const empty = await workflowIn(w, 'active');
    await w.t.run((ctx) => ctx.db.patch(empty, { startNodeId: undefined }));
    await expect(
      w.as.mutation(fn.enrollLeadManually, { workflowId: empty, leadId: await createLead(w) }),
    ).rejects.toThrow('Ce workflow n’a pas de première étape.');
  });
});
