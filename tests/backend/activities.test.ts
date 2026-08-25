import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedEmployee, type SeededEmployee, type T } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  const leadId = await as.mutation(api.features.crm.mutations.createLead, {
    firstName: 'Jean',
    lastName: 'Dupont',
    assignedTo: emp.userId,
  });
  return { t, emp, as, leadId };
}

/** Local day bounds around `now`, like the browser computes them. */
function bounds(now: number) {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { startOfToday: start, endOfToday: start + DAY, endOfWeek: start + 7 * DAY };
}

describe('activities', () => {
  test('a task created from a lead lands in the right bucket of "My tasks"', async () => {
    const { t, as, emp, leadId } = await setup();
    const now = Date.now();
    const b = bounds(now);
    const overdue = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Relancer',
      leadId,
      dueAt: now - 2 * DAY,
    });
    const today = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'call',
      title: 'Appeler',
      leadId,
      dueAt: b.startOfToday + 10 * 60 * 60 * 1000,
    });
    await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'meeting',
      title: 'Rendez-vous',
      leadId,
      dueAt: b.endOfToday + 2 * DAY,
    });
    const undated = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Un jour',
      leadId,
    });
    expect((await t.run((ctx) => ctx.db.get(overdue)))?.ownerId).toBe(emp.userId);

    const counts = await as.query(api.features.activities.queries.countTaskBuckets, b);
    expect(counts).toEqual({ overdue: 1, today: 1, week: 1, later: 0, undated: 1 });

    const page = (args: Record<string, unknown>) =>
      as.query(api.features.activities.queries.listTasks, {
        paginationOpts: { numItems: 10, cursor: null },
        ...args,
      });
    expect((await page({ dueBefore: b.startOfToday })).page.map((a) => a._id)).toEqual([overdue]);
    expect(
      (await page({ dueFrom: b.startOfToday, dueBefore: b.endOfToday })).page.map((a) => a._id),
    ).toEqual([today]);
    expect((await page({ undated: true })).page.map((a) => a._id)).toEqual([undated]);
    expect((await page({ dueFrom: b.endOfWeek })).page).toHaveLength(0);
    // Rows carry the linked names.
    expect((await page({ undated: true })).page[0]).toMatchObject({
      leadName: 'Jean Dupont',
      ownerName: 'Test User',
    });
  });

  test('completing records the outcome and moves the counters; reopen restores', async () => {
    const { t, as, leadId } = await setup();
    const now = Date.now();
    const b = bounds(now);
    const activityId = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Envoyer le devis',
      leadId,
      dueAt: now + 60 * 60 * 1000,
    });
    await as.mutation(api.features.activities.mutations.completeActivity, {
      activityId,
      outcome: 'Devis envoyé par e-mail',
    });
    const done = (await t.run((ctx) => ctx.db.get(activityId)))!;
    expect(done.status).toBe('done');
    expect(done.outcome).toBe('Devis envoyé par e-mail');
    expect(done.completedAt).toBeDefined();
    expect((await as.query(api.features.activities.queries.countTaskBuckets, b)).today).toBe(0);
    const doneList = await as.query(api.features.activities.queries.listTasks, {
      status: 'done',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(doneList.page.map((a) => a._id)).toEqual([activityId]);

    await as.mutation(api.features.activities.mutations.reopenActivity, { activityId });
    expect((await t.run((ctx) => ctx.db.get(activityId)))?.status).toBe('open');
    expect((await as.query(api.features.activities.queries.countTaskBuckets, b)).today).toBe(1);

    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'activity').eq('entityId', activityId))
        .collect(),
    );
    expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'update']);
  });

  test('logging a call records it done with its outcome and can plan the follow-up', async () => {
    const { t, as, leadId } = await setup();
    const res = await as.mutation(api.features.activities.mutations.logCall, {
      leadId,
      outcome: 'Messagerie',
      notes: 'Laissé un message',
      followUp: { title: 'Rappeler', dueAt: Date.now() + DAY },
    });
    const call = (await t.run((ctx) => ctx.db.get(res.callId)))!;
    expect(call).toMatchObject({
      type: 'call',
      status: 'done',
      outcome: 'Messagerie',
      description: 'Laissé un message',
      leadId,
    });
    expect(call.completedAt).toBeDefined();
    const followUp = (await t.run((ctx) => ctx.db.get(res.followUpId!)))!;
    expect(followUp).toMatchObject({ type: 'task', status: 'open', title: 'Rappeler', leadId });

    const forLead = await as.query(api.features.activities.queries.listActivitiesForEntity, {
      leadId,
    });
    // Open first, then the done call.
    expect(forLead.map((a) => a._id)).toEqual([res.followUpId, res.callId]);

    await expect(
      as.mutation(api.features.activities.mutations.logCall, { outcome: 'Répondu' }),
    ).rejects.toThrow('activity_link_required');
  });

  test('linked records must exist; deletion hides the activity', async () => {
    const { as, leadId } = await setup();
    await expect(
      as.mutation(api.features.activities.mutations.createActivity, {
        type: 'task',
        title: 'X',
        dealId: 'k97abc' as Id<'deals'>,
      }),
    ).rejects.toThrow();
    const activityId = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'note',
      title: 'Note',
      leadId,
    });
    await as.mutation(api.features.activities.mutations.deleteActivity, { activityId });
    const forLead = await as.query(api.features.activities.queries.listActivitiesForEntity, {
      leadId,
    });
    expect(forLead).toHaveLength(0);
  });
});

describe('workflow create_task step', () => {
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
    return (
      await t.run((ctx) =>
        ctx.db
          .query('workflowRunSteps')
          .withIndex('by_run', (q) => q.eq('runId', runId))
          .collect(),
      )
    )[0];
  }

  async function activeWorkflow(t: T, emp: SeededEmployee, node: Record<string, unknown>) {
    const as = asIdentity(t, emp.identity);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Tâches',
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

  test('creates the task for the lead’s owner with a relative due date and rendered title', async () => {
    const { t, as, emp, leadId } = await setup();
    const workflowId = await activeWorkflow(t, emp, {
      type: 'create_task',
      activityType: 'call',
      title: 'Rappeler {{ params.firstName }}',
      dueInDays: 2,
    });
    const before = Date.now();
    const step = await runStep(t, workflowId, leadId);
    expect(step.status).toBe('success');
    const tasks = await as.query(api.features.activities.queries.listActivitiesForEntity, {
      leadId,
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      type: 'call',
      title: 'Rappeler Jean',
      ownerId: emp.userId,
      status: 'open',
    });
    expect(tasks[0].dueAt).toBeGreaterThanOrEqual(before + 2 * DAY - 1000);
    expect(tasks[0].createdBy).toBeUndefined();
  });

  test('activation validates the step; an undated task is allowed', async () => {
    const { t, as, emp, leadId } = await setup();
    const bad = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Bad',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: false,
      nodes: [{ id: 'n1', type: 'create_task', title: '   ' }],
      startNodeId: 'n1',
    });
    await expect(
      as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
        workflowId: bad,
        status: 'active',
      }),
    ).rejects.toThrow("l'intitulé est requis");

    const workflowId = await activeWorkflow(t, emp, { type: 'create_task', title: 'Un jour' });
    expect((await runStep(t, workflowId, leadId)).status).toBe('success');
    const tasks = await as.query(api.features.activities.queries.listActivitiesForEntity, {
      leadId,
    });
    expect(tasks[0].dueAt).toBeUndefined();
  });
});
