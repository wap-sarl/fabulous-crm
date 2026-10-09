import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { WorkflowNode, WorkflowTrigger } from '../../convex/_lib/validators/workflows';
import { setExtensionsForTests } from '../../convex/extensions';
import { insertListMember } from '../../convex/lib/leadLists/members';
import { asIdentity, createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const NOW = Date.UTC(2026, 8, 29, 10, 0, 0);
const HOUR_MS = 60 * 60 * 1000;

type World = {
  t: T;
  as: ReturnType<typeof asIdentity>;
  userId: Id<'users'>;
};

async function setup(): Promise<World> {
  const t = createTestConvex();
  pinClock(NOW);
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  return { t, as: asIdentity(t, emp.identity), userId: emp.userId };
}

/** A workflow written as it is stored: the activation checks are not what these tests are about. */
function insertWorkflow(
  w: World,
  nodes: WorkflowNode[],
  overrides: Partial<Doc<'workflows'>> = {},
): Promise<Id<'workflows'>> {
  return w.t.run((ctx) =>
    ctx.db.insert('workflows', {
      name: 'Étapes',
      status: 'active',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes,
      startNodeId: nodes[0]?.id,
      enrolledCount: 1,
      activeCount: 1,
      completedCount: 0,
      updatedAt: NOW,
      createdBy: w.userId,
      updatedBy: w.userId,
      ...overrides,
    }),
  );
}

async function createLead(w: World, patch: Partial<Doc<'leads'>> = {}): Promise<Id<'leads'>> {
  const leadId = await w.as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean@example.com',
    phone: '+33612345678',
  });
  // Consent and absent fields are set on the row: only the public link grants consent.
  if (Object.keys(patch).length > 0) await w.t.run((ctx) => ctx.db.patch(leadId, patch));
  return leadId;
}

function insertRun(
  w: World,
  workflowId: Id<'workflows'>,
  leadId: Id<'leads'>,
  overrides: Partial<Doc<'workflowRuns'>> = {},
): Promise<Id<'workflowRuns'>> {
  return w.t.run((ctx) =>
    ctx.db.insert('workflowRuns', {
      workflowId,
      leadId,
      status: 'active',
      triggerType: 'manual',
      enrolledAt: NOW,
      currentNodeId: 'n1',
      stepCount: 0,
      ...overrides,
    }),
  );
}

const execute = (w: World, runId: Id<'workflowRuns'>, nodeId = 'n1') =>
  w.t.mutation(internal.features.workflows.internal.executeStep, { runId, nodeId });

/** What a step left behind: the run, its logged steps and what it scheduled for this run. */
async function after(w: World, runId: Id<'workflowRuns'>) {
  return await w.t.run(async (ctx) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error('run not found');
    const steps = await ctx.db
      .query('workflowRunSteps')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect();
    const jobs = (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.state.kind === 'pending')
      .map((job) => ({
        name: job.name.split(/[:/.]/).at(-1),
        at: job.scheduledTime,
        args: job.args[0] as { runId?: string; nodeId?: string; stepId?: string },
      }))
      .filter((job) => job.args?.runId === runId);
    const workflow = await ctx.db.get(run.workflowId);
    return { run, steps, jobs, workflow };
  });
}

/** One node run once, on a lead as given. */
async function runNode(
  w: World,
  nodes: WorkflowNode[],
  lead: Partial<Doc<'leads'>> = {},
  workflow: Partial<Doc<'workflows'>> = {},
) {
  const workflowId = await insertWorkflow(w, nodes, workflow);
  const leadId = await createLead(w, lead);
  const runId = await insertRun(w, workflowId, leadId);
  await execute(w, runId);
  return { workflowId, leadId, runId, ...(await after(w, runId)) };
}

const runsOf = (w: World, workflowId: Id<'workflows'>) =>
  w.t.run((ctx) =>
    ctx.db
      .query('workflowRuns')
      .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
      .collect(),
  );

const listening = (w: World, trigger: WorkflowTrigger) =>
  insertWorkflow(w, [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }], {
    trigger,
    enrolledCount: 0,
    activeCount: 0,
  });

const stageIs = (value: string) => ({
  combinator: 'and' as const,
  groups: [
    {
      combinator: 'and' as const,
      rules: [
        {
          field: { kind: 'standard' as const, field: 'lifecycleStage' as const },
          operator: 'equals' as const,
          value,
        },
      ],
    },
  ],
});

const NEXT = (runId: Id<'workflowRuns'>, nodeId: string, at = NOW) => ({
  name: 'executeStep',
  at,
  args: { runId, nodeId },
});

describe('a step of a workflow: the guards', () => {
  test('a schedule for a node the run has left, or for a run that is over, does nothing', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w, [{ id: 'n1', type: 'webhook', url: 'https://x' }]);
    const leadId = await createLead(w);
    const moved = await insertRun(w, workflowId, leadId, { currentNodeId: 'n2' });
    await execute(w, moved);
    expect(await after(w, moved)).toMatchObject({ steps: [], jobs: [], run: { stepCount: 0 } });
    const over = await insertRun(w, workflowId, leadId, { status: 'completed' });
    await execute(w, over);
    expect(await after(w, over)).toMatchObject({ steps: [], jobs: [], run: { stepCount: 0 } });
  });

  test('a paused workflow leaves the run where it is', async () => {
    const w = await setup();
    const { run, steps, jobs } = await runNode(
      w,
      [{ id: 'n1', type: 'webhook', url: 'https://x' }],
      {},
      { status: 'paused' },
    );
    expect(run).toMatchObject({ status: 'active', currentNodeId: 'n1', stepCount: 0 });
    expect(steps).toEqual([]);
    expect(jobs).toEqual([]);
  });

  test('a deleted workflow fails the run and gives back its place', async () => {
    const w = await setup();
    const { run, workflow, steps } = await runNode(
      w,
      [{ id: 'n1', type: 'webhook', url: 'https://x' }],
      {},
      { deletedAt: NOW },
    );
    expect(run.status).toBe('failed');
    expect(run.error).toBe('workflow_deleted');
    expect(run.finishedAt).toBe(NOW);
    expect(run.currentNodeId).toBeUndefined();
    expect(workflow?.activeCount).toBe(0);
    expect(steps).toEqual([]);
  });

  test('a step still pending holds the run', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w, [{ id: 'n1', type: 'webhook', url: 'https://x' }]);
    const leadId = await createLead(w);
    const runId = await insertRun(w, workflowId, leadId);
    await w.t.run((ctx) =>
      ctx.db.insert('workflowRunSteps', {
        runId,
        workflowId,
        leadId,
        nodeId: 'n0',
        nodeType: 'send_email',
        status: 'pending',
        startedAt: NOW,
      }),
    );
    await execute(w, runId);
    const { run, steps, jobs } = await after(w, runId);
    expect(run.stepCount).toBe(0);
    expect(steps).toHaveLength(1);
    expect(jobs).toEqual([]);
  });

  test('a node that is no longer in the graph fails the run', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w, [{ id: 'n1', type: 'webhook', url: 'https://x' }]);
    const leadId = await createLead(w);
    const runId = await insertRun(w, workflowId, leadId, { currentNodeId: 'gone' });
    await execute(w, runId, 'gone');
    const { run, workflow } = await after(w, runId);
    expect(run).toMatchObject({ status: 'failed', error: 'step_removed', finishedAt: NOW });
    expect(workflow?.activeCount).toBe(0);
  });

  test('a deleted contact cancels the run', async () => {
    const w = await setup();
    const { run, workflow, steps } = await runNode(
      w,
      [{ id: 'n1', type: 'webhook', url: 'https://x' }],
      { deletedAt: NOW },
    );
    expect(run).toMatchObject({ status: 'cancelled', error: 'lead_supprime', finishedAt: NOW });
    expect(run.currentNodeId).toBeUndefined();
    expect(workflow?.activeCount).toBe(0);
    expect(steps).toEqual([]);
  });

  test('a step counts, and the last one of a path completes the run', async () => {
    const w = await setup();
    const { run, workflow, steps, jobs } = await runNode(w, [
      {
        id: 'n1',
        type: 'update_property',
        target: { kind: 'standard', field: 'comment' },
        value: 'x',
      },
    ]);
    expect(run).toMatchObject({ status: 'completed', stepCount: 1, finishedAt: NOW });
    expect(run.currentNodeId).toBeUndefined();
    expect(workflow).toMatchObject({ activeCount: 0, completedCount: 1 });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      nodeId: 'n1',
      nodeType: 'update_property',
      status: 'success',
      startedAt: NOW,
      finishedAt: NOW,
    });
    expect(jobs).toEqual([]);
  });
});

describe('a step of a workflow: branch and wait', () => {
  const branch = (value: string): WorkflowNode => ({
    id: 'n1',
    type: 'branch',
    condition: stageIs(value),
    nextTrue: 'yes',
    nextFalse: 'no',
  });

  test('a branch takes the side its condition gives and says which', async () => {
    const w = await setup();
    const yes = await runNode(w, [branch('customer')], { lifecycleStage: 'customer' });
    expect(yes.steps[0]).toMatchObject({ status: 'success', branchResult: true });
    expect(yes.run).toMatchObject({ status: 'active', currentNodeId: 'yes' });
    expect(yes.jobs).toEqual([NEXT(yes.runId, 'yes')]);

    const no = await runNode(w, [branch('mql')], { lifecycleStage: 'customer' });
    expect(no.steps[0]).toMatchObject({ status: 'success', branchResult: false });
    expect(no.run).toMatchObject({ status: 'active', currentNodeId: 'no' });
    expect(no.jobs).toEqual([NEXT(no.runId, 'no')]);
  });

  test('a branch with nothing on the side taken completes the run', async () => {
    const w = await setup();
    const { run, jobs, steps } = await runNode(
      w,
      [{ id: 'n1', type: 'branch', condition: stageIs('customer'), nextTrue: 'yes' }],
      { lifecycleStage: 'lead' },
    );
    expect(steps[0]).toMatchObject({ status: 'success', branchResult: false });
    expect(run.status).toBe('completed');
    expect(jobs).toEqual([]);
  });

  test('a wait parks the run on the node after it and schedules it for the wake time', async () => {
    const w = await setup();
    const { run, steps, jobs, runId } = await runNode(w, [
      { id: 'n1', type: 'wait', amount: 3, unit: 'hours', next: 'n2' },
    ]);
    const wakeAt = NOW + 3 * HOUR_MS;
    expect(steps[0]).toMatchObject({
      status: 'success',
      detail: `réveil le ${new Date(wakeAt).toISOString()}`,
    });
    expect(run).toMatchObject({ status: 'active', currentNodeId: 'n2', wakeAt });
    expect(run.scheduledFnId).toBeDefined();
    expect(jobs).toEqual([NEXT(runId, 'n2', wakeAt)]);
  });

  test('a wait with nothing after it ends the path at once', async () => {
    const w = await setup();
    const { run, steps, jobs } = await runNode(w, [
      { id: 'n1', type: 'wait', amount: 3, unit: 'days' },
    ]);
    expect(steps[0]).toMatchObject({ status: 'success' });
    expect(steps[0].detail).toBeUndefined();
    expect(run.status).toBe('completed');
    expect(jobs).toEqual([]);
  });
});

describe('a step of a workflow: the property of a contact', () => {
  const comment = (value: string | number): WorkflowNode => ({
    id: 'n1',
    type: 'update_property',
    target: { kind: 'standard', field: 'comment' },
    value,
    next: 'n2',
  });

  test('a change is written, and enrolls the contact in the workflows that watch it, not in its own', async () => {
    const w = await setup();
    const watching = await listening(w, { type: 'lead_property_changed' });
    const { leadId, workflowId, run, steps, jobs, runId } = await runNode(
      w,
      [comment('vu')],
      {},
      { trigger: { type: 'lead_property_changed' } },
    );
    expect((await w.t.run((ctx) => ctx.db.get(leadId)))?.comment).toBe('vu');
    expect(steps[0]).toMatchObject({ status: 'success' });
    expect(run).toMatchObject({ status: 'active', currentNodeId: 'n2' });
    expect(jobs).toEqual([NEXT(runId, 'n2')]);
    expect(await runsOf(w, watching)).toHaveLength(1);
    expect(await runsOf(w, workflowId)).toHaveLength(1);
  });

  test('the value it already has is a success that enrolls nobody', async () => {
    const w = await setup();
    const watching = await listening(w, { type: 'lead_property_changed' });
    const { steps, run } = await runNode(w, [comment('vu')], { comment: 'vu' });
    expect(steps[0]).toMatchObject({ status: 'success' });
    expect(run.currentNodeId).toBe('n2');
    expect(await runsOf(w, watching)).toHaveLength(0);
  });

  test('a value the target cannot take skips the step and the run goes on', async () => {
    const w = await setup();
    const { steps, run, leadId, jobs, runId } = await runNode(w, [comment(12)]);
    expect(steps[0]).toMatchObject({ status: 'skipped', detail: 'cible invalide ou supprimée' });
    expect((await w.t.run((ctx) => ctx.db.get(leadId)))?.comment).toBeUndefined();
    expect(run.currentNodeId).toBe('n2');
    expect(jobs).toEqual([NEXT(runId, 'n2')]);
  });

  test('a stage set by a step enrolls in the workflows that watch the stage', async () => {
    const w = await setup();
    const watching = await listening(w, {
      type: 'lead_property_changed',
      watchedFields: [{ kind: 'standard', field: 'lifecycleStage' }],
    });
    const changed = await runNode(w, [{ id: 'n1', type: 'set_lifecycle_stage', stage: 'mql' }]);
    expect(changed.steps[0]).toMatchObject({ status: 'success' });
    expect(changed.steps[0].detail).toBeUndefined();
    expect(await runsOf(w, watching)).toHaveLength(1);

    const same = await runNode(w, [{ id: 'n1', type: 'set_lifecycle_stage', stage: 'mql' }], {
      lifecycleStage: 'mql',
    });
    expect(same.steps[0]).toMatchObject({ status: 'success', detail: 'déjà à ce statut' });
    const none = await runNode(w, [{ id: 'n1', type: 'set_lifecycle_stage' }]);
    expect(none.steps[0]).toMatchObject({ status: 'skipped', detail: 'statut introuvable' });
    expect(none.run.status).toBe('completed');
    expect(await runsOf(w, watching)).toHaveLength(1);
  });
});

describe('a step of a workflow: deals and tasks', () => {
  test('a deal that cannot be created skips the step with the reason', async () => {
    const w = await setup();
    const { steps, run } = await runNode(w, [
      { id: 'n1', type: 'create_deal', title: 'Devis', stageKey: 'no-such-stage', next: 'n2' },
    ]);
    expect(steps[0].status).toBe('skipped');
    expect(steps[0].detail).toBeTruthy();
    expect(run.currentNodeId).toBe('n2');
  });

  test('no open deal skips the move', async () => {
    const w = await setup();
    const { steps, run } = await runNode(w, [
      { id: 'n1', type: 'update_deal_stage', stageKey: 'won', next: 'n2' },
    ]);
    expect(steps[0]).toMatchObject({ status: 'skipped', detail: 'aucune transaction ouverte' });
    expect(run.currentNodeId).toBe('n2');
  });

  test('a task goes to the owner of the contact, then to the author of the workflow, else it is skipped', async () => {
    const w = await setup();
    const task: WorkflowNode = {
      id: 'n1',
      type: 'create_task',
      title: 'Rappeler {{ params.firstName }}',
      description: 'Pour {{ params.lastName }}',
      dueInDays: 2,
      next: 'n2',
    };
    const activities = (leadId: Id<'leads'>) =>
      w.t.run(async (ctx) =>
        (await ctx.db.query('activities').collect()).filter((a) => a.leadId === leadId),
      );

    const byAuthor = await runNode(w, [task]);
    expect(byAuthor.steps[0].status).toBe('success');
    expect(byAuthor.steps[0].detail).toMatch(/^activité /);
    expect(await activities(byAuthor.leadId)).toMatchObject([
      {
        type: 'task',
        title: 'Rappeler Jean',
        description: 'Pour Dupont',
        ownerId: w.userId,
        dueAt: NOW + 2 * 24 * HOUR_MS,
      },
    ]);
    expect(byAuthor.run.currentNodeId).toBe('n2');

    const nobody = await runNode(w, [task], {}, { createdBy: undefined, updatedBy: undefined });
    expect(nobody.steps[0]).toMatchObject({ status: 'skipped', detail: 'aucun propriétaire' });
    expect(await activities(nobody.leadId)).toEqual([]);
    expect(nobody.run.currentNodeId).toBe('n2');
  });

  test('a task for a team has no owner, and a deleted team gives it back to the owner', async () => {
    const w = await setup();
    const team = (deletedAt?: number) =>
      w.t.run((ctx) =>
        ctx.db.insert('teams', {
          name: 'Ventes',
          memberIds: [w.userId],
          updatedAt: NOW,
          deletedAt,
        }),
      );
    const task = (teamId: Id<'teams'>): WorkflowNode => ({
      id: 'n1',
      type: 'create_task',
      title: 'Rappeler',
      teamId,
      next: 'n2',
    });
    const taskOf = (leadId: Id<'leads'>) =>
      w.t.run(async (ctx) =>
        (await ctx.db.query('activities').collect()).filter((a) => a.leadId === leadId),
      );

    const teamId = await team();
    const forTeam = await runNode(w, [task(teamId)]);
    expect(forTeam.steps[0].status).toBe('success');
    const [teamTask] = await taskOf(forTeam.leadId);
    expect(teamTask).toMatchObject({ title: 'Rappeler', teamId });
    expect(teamTask.ownerId).toBeUndefined();
    expect(forTeam.run.currentNodeId).toBe('n2');

    // No author either: the team alone is enough.
    const teamOnly = await runNode(
      w,
      [task(teamId)],
      {},
      { createdBy: undefined, updatedBy: undefined },
    );
    expect(teamOnly.steps[0].status).toBe('success');
    expect((await taskOf(teamOnly.leadId))[0]).toMatchObject({ teamId });

    const deleted = await team(NOW);
    const fallback = await runNode(w, [task(deleted)]);
    expect(fallback.steps[0].status).toBe('success');
    const [ownerTask] = await taskOf(fallback.leadId);
    expect(ownerTask).toMatchObject({ title: 'Rappeler', ownerId: w.userId });
    expect(ownerTask.teamId).toBeUndefined();

    const nobody = await runNode(
      w,
      [task(deleted)],
      {},
      { createdBy: undefined, updatedBy: undefined },
    );
    expect(nobody.steps[0]).toMatchObject({ status: 'skipped', detail: 'aucun propriétaire' });
  });
});

describe('a step of a workflow: lists', () => {
  async function list(w: World, kind: 'static' | 'dynamic' = 'static') {
    return await w.as.mutation(api.features.leadLists.mutations.createLeadList, {
      name: `Liste ${kind}`,
      kind,
      ...(kind === 'dynamic' ? { criteria: stageIs('customer') } : {}),
    });
  }
  const members = (w: World, listId: Id<'leadLists'>) =>
    w.t.run((ctx) =>
      ctx.db
        .query('leadListMembers')
        .withIndex('by_list_lead', (q) => q.eq('listId', listId))
        .collect(),
    );

  for (const type of ['add_to_list', 'remove_from_list'] as const) {
    test(`${type}: no list, a deleted list and a dynamic list skip the step`, async () => {
      const w = await setup();
      const none = await runNode(w, [{ id: 'n1', type, next: 'n2' }]);
      expect(none.steps[0]).toMatchObject({ status: 'skipped', detail: 'liste introuvable' });
      expect(none.jobs).toEqual([NEXT(none.runId, 'n2')]);

      const deleted = await list(w);
      await w.t.run((ctx) => ctx.db.delete(deleted));
      const gone = await runNode(w, [{ id: 'n1', type, listId: deleted, next: 'n2' }]);
      expect(gone.steps[0]).toMatchObject({ status: 'skipped', detail: 'liste introuvable' });
      expect(gone.run.currentNodeId).toBe('n2');

      const dynamic = await runNode(w, [
        { id: 'n1', type, listId: await list(w, 'dynamic'), next: 'n2' },
      ]);
      expect(dynamic.steps[0]).toMatchObject({
        status: 'skipped',
        detail: 'liste dynamique (membres calculés)',
      });
      expect(dynamic.jobs).toEqual([NEXT(dynamic.runId, 'n2')]);
    });
  }

  test('add_to_list adds once, in the name of the author of the workflow, and enrolls the workflows that watch the list', async () => {
    const w = await setup();
    const listId = await list(w);
    const watching = await listening(w, { type: 'list_membership_changed', change: 'added' });
    const node: WorkflowNode = { id: 'n1', type: 'add_to_list', listId, next: 'n2' };

    const workflowId = await insertWorkflow(w, [node]);
    const leadId = await createLead(w);
    const first = await insertRun(w, workflowId, leadId);
    await execute(w, first);
    const added = await after(w, first);
    expect(added.steps[0]).toMatchObject({ status: 'success' });
    expect(added.steps[0].detail).toBeUndefined();
    expect(await members(w, listId)).toMatchObject([{ leadId, addedBy: w.userId }]);
    expect(added.jobs).toEqual([NEXT(first, 'n2')]);
    expect(await runsOf(w, watching)).toHaveLength(1);

    const second = await insertRun(w, workflowId, leadId);
    await execute(w, second);
    expect((await after(w, second)).steps[0]).toMatchObject({
      status: 'success',
      detail: 'déjà dans la liste',
    });
    expect(await members(w, listId)).toHaveLength(1);
    expect(await runsOf(w, watching)).toHaveLength(1);
  });

  test('add_to_list without an author of the workflow is skipped', async () => {
    const w = await setup();
    const listId = await list(w);
    const { steps, run } = await runNode(
      w,
      [{ id: 'n1', type: 'add_to_list', listId, next: 'n2' }],
      {},
      { createdBy: undefined, updatedBy: undefined },
    );
    expect(steps[0]).toMatchObject({ status: 'skipped', detail: 'workflow sans auteur' });
    expect(await members(w, listId)).toEqual([]);
    expect(run.currentNodeId).toBe('n2');
  });

  test('remove_from_list removes a member, and says so when there was none', async () => {
    const w = await setup();
    const listId = await list(w);
    const watching = await listening(w, { type: 'list_membership_changed', change: 'removed' });
    const node: WorkflowNode = { id: 'n1', type: 'remove_from_list', listId, next: 'n2' };

    const absent = await runNode(w, [node]);
    expect(absent.steps[0]).toMatchObject({ status: 'success', detail: 'déjà hors de la liste' });
    expect(absent.jobs).toEqual([NEXT(absent.runId, 'n2')]);
    expect(await runsOf(w, watching)).toHaveLength(0);

    const workflowId = await insertWorkflow(w, [node]);
    const leadId = await createLead(w);
    // Through the counted path: a raw insert would leave the list's counter without the row.
    await w.t.run((ctx) => insertListMember(ctx, { listId, leadId, addedBy: w.userId }));
    const runId = await insertRun(w, workflowId, leadId);
    await execute(w, runId);
    const removed = await after(w, runId);
    expect(removed.steps[0]).toMatchObject({ status: 'success' });
    expect(removed.steps[0].detail).toBeUndefined();
    expect(await members(w, listId)).toEqual([]);
    expect(removed.jobs).toEqual([NEXT(runId, 'n2')]);
    expect(await runsOf(w, watching)).toHaveLength(1);
  });
});

describe('a step of a workflow: sends and webhooks', () => {
  const email: WorkflowNode = {
    id: 'n1',
    type: 'send_email',
    subject: 'Bonjour {{ params.firstName }}',
    htmlBody: '<p>Bonjour</p>',
    next: 'n2',
  };
  const sms: WorkflowNode = { id: 'n1', type: 'send_sms', smsBody: 'Bonjour', next: 'n2' };
  const webhook: WorkflowNode = {
    id: 'n1',
    type: 'webhook',
    url: 'https://hook.example',
    next: 'n2',
  };

  test('an e-mail needs an address and the consent, a text message a number and the consent', async () => {
    const w = await setup();
    const cases = [
      {
        node: email,
        lead: { email: undefined, marketingConsent: ['email' as const] },
        status: 'skipped_no_email',
      },
      { node: email, lead: { marketingConsent: ['sms' as const] }, status: 'skipped_no_consent' },
      {
        node: sms,
        lead: { phone: undefined, marketingConsent: ['sms' as const] },
        status: 'skipped_no_phone',
      },
      { node: sms, lead: { marketingConsent: ['email' as const] }, status: 'skipped_no_consent' },
    ];
    for (const { node, lead, status } of cases) {
      const { steps, run, jobs, runId } = await runNode(w, [node], lead);
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ status, finishedAt: NOW });
      expect(run).toMatchObject({ status: 'active', currentNodeId: 'n2' });
      expect(jobs).toEqual([NEXT(runId, 'n2')]);
    }
  });

  test('a send the deployment refuses is skipped with the reason, and the run goes on', async () => {
    const w = await setup();
    const asked: unknown[] = [];
    setExtensionsForTests({
      beforeSend: async (_ctx, info) => {
        asked.push(info);
        throw new Error('quota_exceeded');
      },
    });
    const cases = [
      { node: email, channel: 'email' as const },
      { node: sms, channel: 'sms' as const },
    ];
    for (const { node, channel } of cases) {
      const { steps, run, jobs, runId } = await runNode(w, [node], { marketingConsent: [channel] });
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({
        status: 'skipped',
        detail: 'quota_exceeded',
        finishedAt: NOW,
      });
      expect(run).toMatchObject({ status: 'active', currentNodeId: 'n2' });
      expect(jobs).toEqual([NEXT(runId, 'n2')]);
    }
    expect(asked).toEqual([
      { channel: 'email', count: 1, source: 'workflow' },
      { channel: 'sms', count: 1, source: 'workflow' },
    ]);

    // Without the address or the consent the deployment is not asked, and a webhook is not a send.
    await runNode(w, [email], { email: undefined, marketingConsent: ['email'] });
    await runNode(w, [sms], { marketingConsent: [] });
    const hooked = await runNode(w, [webhook]);
    expect(hooked.steps[0].status).toBe('pending');
    expect(asked).toHaveLength(2);
  });

  test('a send and a webhook leave a pending step and hand it to the action, the run stays on the node', async () => {
    const w = await setup();
    const cases = [
      { node: email, lead: { marketingConsent: ['email' as const] } },
      { node: sms, lead: { marketingConsent: ['sms' as const] } },
      { node: webhook, lead: {} },
    ];
    for (const { node, lead } of cases) {
      const { steps, run, jobs, runId } = await runNode(w, [node], lead);
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ status: 'pending', nodeType: node.type, startedAt: NOW });
      expect(steps[0].finishedAt).toBeUndefined();
      expect(run).toMatchObject({ status: 'active', currentNodeId: 'n1', stepCount: 1 });
      expect(jobs).toEqual([
        {
          name: 'runWorkflowActionStep',
          at: NOW,
          args: { runId, stepId: steps[0]._id, nodeId: 'n1' },
        },
      ]);
    }
  });

  test('the action is given what it sends, and nothing when the step can no longer run', async () => {
    const w = await setup();
    const context = (runId: Id<'workflowRuns'>, stepId: Id<'workflowRunSteps'>) =>
      w.t.query(internal.features.workflows.internal.getActionStepContext, {
        runId,
        stepId,
        nodeId: 'n1',
      });

    const sent = await runNode(w, [email], { marketingConsent: ['email'] });
    const forEmail = await context(sent.runId, sent.steps[0]._id);
    expect(forEmail).toMatchObject({
      kind: 'email',
      to: 'jean@example.com',
      subject: 'Bonjour {{ params.firstName }}',
      htmlBody: '<p>Bonjour</p>',
      params: { firstName: 'Jean', lastName: 'Dupont' },
    });

    const texted = await runNode(w, [sms], { marketingConsent: ['sms'] });
    expect(await context(texted.runId, texted.steps[0]._id)).toMatchObject({
      kind: 'sms',
      phone: '+33612345678',
      smsBody: 'Bonjour',
      params: { firstName: 'Jean' },
    });

    const hooked = await runNode(w, [webhook], { marketingConsent: ['email'] });
    const forHook = await context(hooked.runId, hooked.steps[0]._id);
    expect(forHook).toMatchObject({
      kind: 'webhook',
      url: 'https://hook.example',
      payload: {
        workflow: { id: hooked.workflowId, name: 'Étapes' },
        run: { id: hooked.runId, enrolledAt: NOW, triggerType: 'manual' },
        node: { id: 'n1' },
        lead: {
          id: hooked.leadId,
          firstName: 'Jean',
          lastName: 'Dupont',
          email: 'jean@example.com',
          phone: '+33612345678',
          marketingConsent: ['email'],
        },
        timestamp: NOW,
      },
    });
    expect(JSON.stringify(forHook)).not.toContain('consentToken');

    // The address went away, the contact was deleted, the run was cancelled, the node is another kind.
    await w.t.run((ctx) => ctx.db.patch(sent.leadId, { email: undefined }));
    expect(await context(sent.runId, sent.steps[0]._id)).toBeNull();
    await w.t.run((ctx) => ctx.db.patch(texted.leadId, { deletedAt: NOW }));
    expect(await context(texted.runId, texted.steps[0]._id)).toBeNull();
    await w.t.run((ctx) => ctx.db.patch(hooked.runId, { status: 'cancelled' }));
    expect(await context(hooked.runId, hooked.steps[0]._id)).toBeNull();
    const other = await runNode(w, [
      { id: 'n1', type: 'wait', amount: 1, unit: 'hours', next: 'n1' },
    ]);
    expect(await context(other.runId, other.steps[0]._id)).toBeNull();
  });

  test('the end of the action closes the step and moves the run, without scheduling while the workflow is paused', async () => {
    const w = await setup();
    const complete = (runId: Id<'workflowRuns'>, stepId: Id<'workflowRunSteps'>) =>
      w.t.mutation(internal.features.workflows.internal.completeActionStep, {
        runId,
        stepId,
        nodeId: 'n1',
        status: 'failed',
        detail: 'HTTP 500',
      });

    const active = await runNode(w, [webhook]);
    await complete(active.runId, active.steps[0]._id);
    const moved = await after(w, active.runId);
    expect(moved.steps[0]).toMatchObject({ status: 'failed', detail: 'HTTP 500', finishedAt: NOW });
    expect(moved.run).toMatchObject({ status: 'active', currentNodeId: 'n2' });
    expect(moved.jobs.filter((job) => job.name === 'executeStep')).toEqual([
      NEXT(active.runId, 'n2'),
    ]);

    const paused = await runNode(w, [webhook]);
    await w.t.run((ctx) => ctx.db.patch(paused.workflowId, { status: 'paused' }));
    await complete(paused.runId, paused.steps[0]._id);
    const parked = await after(w, paused.runId);
    expect(parked.steps[0]).toMatchObject({ status: 'failed' });
    expect(parked.run).toMatchObject({ status: 'active', currentNodeId: 'n2' });
    expect(parked.jobs.filter((job) => job.name === 'executeStep')).toEqual([]);

    const last = await runNode(w, [{ id: 'n1', type: 'webhook', url: 'https://hook.example' }]);
    await complete(last.runId, last.steps[0]._id);
    const done = await after(w, last.runId);
    expect(done.run.status).toBe('completed');
    expect(done.workflow).toMatchObject({ activeCount: 0, completedCount: 1 });

    const edited = await runNode(w, [webhook]);
    await w.t.run((ctx) => ctx.db.patch(edited.workflowId, { nodes: [] }));
    await complete(edited.runId, edited.steps[0]._id);
    expect((await after(w, edited.runId)).run).toMatchObject({
      status: 'failed',
      error: 'step_removed',
    });
  });
});
