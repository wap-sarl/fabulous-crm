import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { LeadAdvancedFilter } from '../../convex/_lib/validators/filters';
import type { WorkflowNode } from '../../convex/_lib/validators/workflows';
import { asIdentity, createTestConvex, pinClock, seedEmployee, seedLead, type T } from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const HOUR_MS = 60 * 60 * 1000;
const read = api.features.workflows.queries;

type As = ReturnType<typeof asIdentity>;
type World = {
  t: T;
  // Sees everything.
  as: As;
  adminId: Id<'users'>;
  // Sees its own workflows and contacts, and those of nobody.
  asMember: As;
  memberId: Id<'users'>;
};

async function setup(): Promise<World> {
  const t = createTestConvex();
  pinClock(NOW);
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  return {
    t,
    as: asIdentity(t, admin.identity),
    adminId: admin.userId,
    asMember: asIdentity(t, member.identity),
    memberId: member.userId,
  };
}

const stageIs = (value: string): LeadAdvancedFilter => ({
  combinator: 'and',
  groups: [
    {
      combinator: 'and',
      rules: [{ field: { kind: 'standard', field: 'lifecycleStage' }, operator: 'equals', value }],
    },
  ],
});

const NODES: WorkflowNode[] = [
  {
    id: 'n1',
    type: 'send_email',
    subject: 'Bonjour {{ params.firstName }}',
    htmlBody: '<p>Bonjour</p>',
    next: 'n2',
    position: { x: 0, y: 0 },
  },
  { id: 'n2', type: 'wait', amount: 2, unit: 'days', next: 'n3' },
  { id: 'n3', type: 'branch', condition: stageIs('customer'), nextTrue: 'n4' },
  { id: 'n4', type: 'webhook', url: 'https://hook.example.com/crm' },
];

/** A workflow written as it is stored. */
function insertWorkflow(
  w: World,
  overrides: Partial<Doc<'workflows'>> = {},
): Promise<Id<'workflows'>> {
  return w.t.run((ctx) =>
    ctx.db.insert('workflows', {
      name: 'Relance',
      status: 'active',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: NODES,
      startNodeId: 'n1',
      enrolledCount: 0,
      activeCount: 0,
      completedCount: 0,
      updatedAt: NOW,
      createdBy: w.adminId,
      updatedBy: w.adminId,
      ...overrides,
    }),
  );
}

/** A run written as the engine leaves it. */
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
      triggerType: 'consent_updated',
      enrolledAt: NOW,
      currentNodeId: 'n1',
      stepCount: 0,
      ...overrides,
    }),
  );
}

/** A run asleep on a wait, its wake scheduled as the engine does. */
async function insertSleepingRun(
  w: World,
  workflowId: Id<'workflows'>,
  leadId: Id<'leads'>,
  overrides: Partial<Doc<'workflowRuns'>> = {},
) {
  const runId = await insertRun(w, workflowId, leadId, {
    currentNodeId: 'n3',
    stepCount: 2,
    ...overrides,
  });
  await w.t.run(async (ctx) => {
    const wakeAt = NOW + 2 * HOUR_MS;
    const scheduledFnId = await ctx.scheduler.runAt(
      wakeAt,
      internal.features.workflows.internal.executeStep,
      { runId, nodeId: 'n3' },
    );
    await ctx.db.patch(runId, { wakeAt, scheduledFnId });
  });
  return runId;
}

function insertStep(
  w: World,
  run: Doc<'workflowRuns'>,
  step: Pick<Doc<'workflowRunSteps'>, 'nodeId' | 'nodeType' | 'status' | 'startedAt'> &
    Partial<Doc<'workflowRunSteps'>>,
): Promise<Id<'workflowRunSteps'>> {
  return w.t.run((ctx) =>
    ctx.db.insert('workflowRunSteps', {
      runId: run._id,
      workflowId: run.workflowId,
      leadId: run.leadId,
      ...step,
    }),
  );
}

const stored = <Table extends 'workflows' | 'workflowRuns' | 'workflowRunSteps'>(
  w: World,
  id: Id<Table>,
) =>
  w.t.run(async (ctx) => {
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error(`${id} not found`);
    return doc as Doc<Table>;
  });

const remove = (w: World, id: Id<'workflows' | 'workflowRuns' | 'leads'>) =>
  w.t.run((ctx) => ctx.db.delete(id));

const page = (numItems: number, cursor: string | null = null) => ({ numItems, cursor });

describe('a workflow as the editor reads it', () => {
  test('the whole document comes back, with everything it stores', async () => {
    const w = await setup();
    const fields = {
      name: 'Relance des MQL',
      description: 'Trois jours après le passage en MQL',
      status: 'paused' as const,
      trigger: {
        type: 'score_threshold_crossed' as const,
        threshold: 50,
        direction: 'up' as const,
      },
      enrollmentCriteria: stageIs('mql'),
      allowReEnrollment: false,
      nodes: NODES,
      startNodeId: 'n1',
      enrolledCount: 3,
      activeCount: 1,
      completedCount: 2,
      bulkReenroll: {
        status: 'done' as const,
        startedBy: w.adminId,
        matched: 4,
        enrolled: 2,
        cancelled: 1,
        skipped: 1,
        startedAt: NOW - HOUR_MS,
        finishedAt: NOW,
      },
      updatedAt: NOW,
      createdBy: w.adminId,
      updatedBy: w.adminId,
    };
    const workflowId = await insertWorkflow(w, fields);

    const workflow = await w.as.query(read.getWorkflow, { workflowId });
    expect(workflow).toEqual({ _id: workflowId, _creationTime: expect.any(Number), ...fields });
  });

  test('an empty draft comes back without the fields it does not have', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w, {
      status: 'draft',
      nodes: [],
      startNodeId: undefined,
      createdBy: undefined,
      updatedBy: undefined,
    });
    const workflow = await w.as.query(read.getWorkflow, { workflowId });
    expect(workflow).toEqual({
      _id: workflowId,
      _creationTime: expect.any(Number),
      name: 'Relance',
      status: 'draft',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [],
      enrolledCount: 0,
      activeCount: 0,
      completedCount: 0,
      updatedAt: NOW,
    });
    // Nobody owns it: an employee who sees only its own workflows reads it too.
    expect(await w.asMember.query(read.getWorkflow, { workflowId })).toEqual(workflow);
  });

  test('a workflow in the bin, one that is gone and one the employee may not see give nothing', async () => {
    const w = await setup();
    const binned = await insertWorkflow(w, { deletedAt: NOW });
    const gone = await insertWorkflow(w);
    await remove(w, gone);
    const ofAdmin = await insertWorkflow(w);

    expect(await w.as.query(read.getWorkflow, { workflowId: binned })).toBeNull();
    expect(await w.as.query(read.getWorkflow, { workflowId: gone })).toBeNull();
    expect(await w.asMember.query(read.getWorkflow, { workflowId: ofAdmin })).toBeNull();
    expect(await w.as.query(read.getWorkflow, { workflowId: ofAdmin })).not.toBeNull();
  });
});

describe('the runs of a workflow', () => {
  /** Three runs, oldest first: asleep on a wait, failed by hand-enrollment, completed for a contact that is gone. */
  async function threeRuns(w: World) {
    const workflowId = await insertWorkflow(w, { enrolledCount: 3, activeCount: 1 });
    const jean = await seedLead(w.t, {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@example.com',
    });
    const anna = await seedLead(w.t, { firstName: 'Anna', lastName: 'Martin', email: undefined });
    const erased = await seedLead(w.t, { email: 'erased@example.com' });
    const asleep = await insertSleepingRun(w, workflowId, jean, { enrolledAt: NOW - 3 * HOUR_MS });
    const failed = await insertRun(w, workflowId, anna, {
      status: 'failed',
      triggerType: 'manual',
      manual: true,
      enrolledAt: NOW - 2 * HOUR_MS,
      finishedAt: NOW - HOUR_MS,
      currentNodeId: undefined,
      stepCount: 1,
      error: 'step_removed',
    });
    const completed = await insertRun(w, workflowId, erased, {
      status: 'completed',
      enrolledAt: NOW - HOUR_MS,
      finishedAt: NOW,
      currentNodeId: undefined,
      stepCount: 4,
    });
    await remove(w, erased);
    return { workflowId, jean, anna, erased, asleep, failed, completed };
  }

  test('a workflow nobody entered has an empty, finished page', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w);
    const result = await w.as.query(read.listRuns, { workflowId, paginationOpts: page(10) });
    expect(result).toMatchObject({ page: [], isDone: true });
    expect(typeof result.continueCursor).toBe('string');
  });

  test('the runs come newest first, each whole, with its contact when it still exists', async () => {
    const w = await setup();
    const { workflowId, jean, anna, erased, asleep, failed, completed } = await threeRuns(w);

    const result = await w.as.query(read.listRuns, { workflowId, paginationOpts: page(10) });

    expect(result.isDone).toBe(true);
    expect(result.page).toEqual([
      { ...(await stored(w, completed)), lead: null },
      {
        ...(await stored(w, failed)),
        lead: { _id: anna, firstName: 'Anna', lastName: 'Martin', email: undefined },
      },
      {
        ...(await stored(w, asleep)),
        lead: { _id: jean, firstName: 'Jean', lastName: 'Dupont', email: 'jean@example.com' },
      },
    ]);
    expect(result.page[0]).toMatchObject({
      leadId: erased,
      status: 'completed',
      finishedAt: NOW,
      stepCount: 4,
    });
    expect(result.page[1]).toMatchObject({
      status: 'failed',
      manual: true,
      triggerType: 'manual',
      error: 'step_removed',
      finishedAt: NOW - HOUR_MS,
    });
    // A contact without an address comes without the field, not with an empty one.
    expect(Object.keys(result.page[1].lead ?? {}).sort()).toEqual(['_id', 'firstName', 'lastName']);
    expect(result.page[2]).toMatchObject({
      status: 'active',
      currentNodeId: 'n3',
      wakeAt: NOW + 2 * HOUR_MS,
      scheduledFnId: expect.any(String),
    });
  });

  test('a status keeps the runs in that status only', async () => {
    const w = await setup();
    const { workflowId, asleep, failed, completed } = await threeRuns(w);
    const idsIn = async (status: Doc<'workflowRuns'>['status']) =>
      (await w.as.query(read.listRuns, { workflowId, status, paginationOpts: page(10) })).page.map(
        (run) => run._id,
      );

    expect(await idsIn('active')).toEqual([asleep]);
    expect(await idsIn('failed')).toEqual([failed]);
    expect(await idsIn('completed')).toEqual([completed]);
    expect(await idsIn('cancelled')).toEqual([]);
  });

  test('a page ends where the next one starts', async () => {
    const w = await setup();
    const { workflowId, asleep, failed, completed } = await threeRuns(w);

    const first = await w.as.query(read.listRuns, { workflowId, paginationOpts: page(2) });
    expect(first.page.map((run) => run._id)).toEqual([completed, failed]);
    expect(first.isDone).toBe(false);

    const second = await w.as.query(read.listRuns, {
      workflowId,
      paginationOpts: page(2, first.continueCursor),
    });
    expect(second.page.map((run) => run._id)).toEqual([asleep]);
    expect(second.isDone).toBe(true);
  });

  test('an employee reads the runs of its workflows, without the contacts of somebody else, and no run of the others', async () => {
    const w = await setup();
    const mine = await insertWorkflow(w, { createdBy: w.memberId });
    const ofAdmin = await insertWorkflow(w);
    const own = await seedLead(w.t, { email: 'own@example.com', ownerIds: [w.memberId] });
    const foreign = await seedLead(w.t, { email: 'foreign@example.com', ownerIds: [w.adminId] });
    const onOwn = await insertRun(w, mine, own);
    const onForeign = await insertRun(w, mine, foreign);
    await insertRun(w, ofAdmin, own);

    const result = await w.asMember.query(read.listRuns, {
      workflowId: mine,
      paginationOpts: page(10),
    });
    expect(result.page.map((run) => ({ _id: run._id, lead: run.lead?._id ?? null }))).toEqual([
      { _id: onForeign, lead: null },
      { _id: onOwn, lead: own },
    ]);
    const hidden = await w.asMember.query(read.listRuns, {
      workflowId: ofAdmin,
      paginationOpts: page(10),
    });
    expect(hidden.page).toEqual([]);
  });
});

describe('one run of a workflow', () => {
  test('a run that is gone gives nothing', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w);
    const runId = await insertRun(w, workflowId, await seedLead(w.t, {}));
    await remove(w, runId);
    expect(await w.as.query(read.getRun, { runId })).toBeNull();
  });

  test('the run comes with its contact, the nodes of its workflow and its steps in the order they started', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w, { name: 'Relance des MQL', activeCount: 1 });
    const leadId = await seedLead(w.t, {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@example.com',
    });
    const runId = await insertSleepingRun(w, workflowId, leadId, { enrolledAt: NOW - HOUR_MS });
    const run = await stored(w, runId);
    // Written out of order: the log is sorted when it is read.
    const waited = await insertStep(w, run, {
      nodeId: 'n2',
      nodeType: 'wait',
      status: 'success',
      startedAt: NOW - 30_000,
      finishedAt: NOW - 30_000,
      detail: `réveil le ${new Date(NOW + 2 * HOUR_MS).toISOString()}`,
    });
    const sent = await insertStep(w, run, {
      nodeId: 'n1',
      nodeType: 'send_email',
      status: 'failed',
      startedAt: NOW - 60_000,
      finishedAt: NOW - 59_000,
      detail: '{"code":"unauthorized","message":"Key not found"}',
    });
    const branched = await insertStep(w, run, {
      nodeId: 'n3',
      nodeType: 'branch',
      status: 'success',
      startedAt: NOW - 20_000,
      finishedAt: NOW - 20_000,
      branchResult: true,
    });
    const calling = await insertStep(w, run, {
      nodeId: 'n4',
      nodeType: 'webhook',
      status: 'pending',
      startedAt: NOW - 10_000,
    });

    const result = await w.as.query(read.getRun, { runId });

    expect(result).toEqual({
      ...run,
      lead: { _id: leadId, firstName: 'Jean', lastName: 'Dupont', email: 'jean@example.com' },
      workflow: { _id: workflowId, name: 'Relance des MQL', nodes: NODES },
      steps: [
        await stored(w, sent),
        await stored(w, waited),
        await stored(w, branched),
        await stored(w, calling),
      ],
    });
    expect(result).toMatchObject({ wakeAt: NOW + 2 * HOUR_MS, scheduledFnId: run.scheduledFnId });
    expect(result?.steps.map((s) => [s.nodeId, s.status, s.branchResult, s.finishedAt])).toEqual([
      ['n1', 'failed', undefined, NOW - 59_000],
      ['n2', 'success', undefined, NOW - 30_000],
      ['n3', 'success', true, NOW - 20_000],
      ['n4', 'pending', undefined, undefined],
    ]);
  });

  test('a run whose workflow and contact are gone keeps its own fields, with no step', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w);
    const leadId = await seedLead(w.t, {});
    const runId = await insertRun(w, workflowId, leadId, {
      status: 'failed',
      finishedAt: NOW,
      currentNodeId: undefined,
      error: 'workflow_deleted',
    });
    await remove(w, workflowId);
    await remove(w, leadId);

    expect(await w.as.query(read.getRun, { runId })).toEqual({
      ...(await stored(w, runId)),
      lead: null,
      workflow: null,
      steps: [],
    });
    // Only who sees every workflow reads it: nothing says any more whose workflow it was.
    expect(await w.asMember.query(read.getRun, { runId })).toBeNull();
  });

  test('a workflow in the bin still names the nodes of its runs', async () => {
    const w = await setup();
    const workflowId = await insertWorkflow(w, { deletedAt: NOW });
    const runId = await insertRun(w, workflowId, await seedLead(w.t, {}), {
      status: 'cancelled',
      finishedAt: NOW,
      currentNodeId: undefined,
    });
    expect((await w.as.query(read.getRun, { runId }))?.workflow).toEqual({
      _id: workflowId,
      name: 'Relance',
      nodes: NODES,
    });
  });

  test('an employee reads the run of its workflow without the contact of somebody else, and not the run of another workflow', async () => {
    const w = await setup();
    const mine = await insertWorkflow(w, { createdBy: w.memberId });
    const ofAdmin = await insertWorkflow(w);
    const foreign = await seedLead(w.t, { email: 'foreign@example.com', ownerIds: [w.adminId] });
    const visible = await insertRun(w, mine, foreign);
    const hidden = await insertRun(w, ofAdmin, foreign);
    await insertStep(w, await stored(w, visible), {
      nodeId: 'n1',
      nodeType: 'send_email',
      status: 'skipped_no_consent',
      startedAt: NOW,
      finishedAt: NOW,
    });

    const result = await w.asMember.query(read.getRun, { runId: visible });
    expect(result).toMatchObject({ _id: visible, lead: null, workflow: { _id: mine } });
    expect(result?.steps).toMatchObject([{ nodeId: 'n1', status: 'skipped_no_consent' }]);
    expect(await w.asMember.query(read.getRun, { runId: hidden })).toBeNull();
  });
});

describe('the runs of a contact', () => {
  test('a contact no workflow enrolled has none', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    expect(await w.as.query(read.listRunsForLead, { leadId })).toEqual([]);
  });

  test('its runs come latest enrollment first, each whole, with the name of its workflow', async () => {
    const w = await setup();
    const welcome = await insertWorkflow(w, { name: 'Bienvenue' });
    const followUp = await insertWorkflow(w, { name: 'Relance' });
    const purged = await insertWorkflow(w, { name: 'Purgé' });
    const leadId = await seedLead(w.t, { email: 'jean@example.com' });
    const other = await seedLead(w.t, { email: 'other@example.com' });
    // Written out of order: the history is sorted on the enrollment date.
    const middle = await insertRun(w, followUp, leadId, {
      status: 'cancelled',
      enrolledAt: NOW - 2 * HOUR_MS,
      finishedAt: NOW - HOUR_MS,
      currentNodeId: undefined,
      error: 'lead_supprime',
    });
    const oldest = await insertRun(w, purged, leadId, {
      status: 'completed',
      triggerType: 'manual',
      manual: true,
      enrolledAt: NOW - 3 * HOUR_MS,
      finishedAt: NOW - 2 * HOUR_MS,
      currentNodeId: undefined,
      stepCount: 4,
    });
    const latest = await insertSleepingRun(w, welcome, leadId, { enrolledAt: NOW - HOUR_MS });
    await insertRun(w, welcome, other);
    await remove(w, purged);

    expect(await w.as.query(read.listRunsForLead, { leadId })).toEqual([
      { ...(await stored(w, latest)), workflowName: 'Bienvenue' },
      { ...(await stored(w, middle)), workflowName: 'Relance' },
      { ...(await stored(w, oldest)), workflowName: 'Workflow supprimé' },
    ]);
  });

  test('an employee reads the runs of the workflows it may see only', async () => {
    const w = await setup();
    const mine = await insertWorkflow(w, { name: 'Le mien', createdBy: w.memberId });
    const ofAdmin = await insertWorkflow(w, { name: "Celui d'un autre" });
    const leadId = await seedLead(w.t, { ownerIds: [w.memberId] });
    const visible = await insertRun(w, mine, leadId);
    await insertRun(w, ofAdmin, leadId);

    const runs = await w.asMember.query(read.listRunsForLead, { leadId });
    expect(runs.map((run) => ({ _id: run._id, workflowName: run.workflowName }))).toEqual([
      { _id: visible, workflowName: 'Le mien' },
    ]);
    expect(await w.as.query(read.listRunsForLead, { leadId })).toHaveLength(2);
  });
});
