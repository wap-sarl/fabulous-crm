import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import type { WorkflowNode, WorkflowStepOutcome } from '../../_lib/validators/workflows';

/** What a step works on, read by `executeStep` before the node runs; `source` names the run to the triggers its writes fire. */
export type StepContext = {
  ctx: MutationCtx;
  run: Doc<'workflowRuns'>;
  workflow: Doc<'workflows'>;
  lead: Doc<'leads'>;
  source: { runId: Id<'workflowRuns'>; workflowId: Id<'workflows'> };
};

export type NodeOf<T extends WorkflowNode['type']> = Extract<WorkflowNode, { type: T }>;

/** Insert a workflowRunSteps row. Non-pending outcomes are final immediately. */
export async function logStep(
  ctx: MutationCtx,
  run: Doc<'workflowRuns'>,
  node: WorkflowNode,
  status: WorkflowStepOutcome,
  extra?: { detail?: string; branchResult?: boolean },
): Promise<Id<'workflowRunSteps'>> {
  const now = Date.now();
  return await ctx.db.insert('workflowRunSteps', {
    runId: run._id,
    workflowId: run.workflowId,
    leadId: run.leadId,
    nodeId: node.id,
    nodeType: node.type,
    status,
    startedAt: now,
    finishedAt: status === 'pending' ? undefined : now,
    branchResult: extra?.branchResult,
    detail: extra?.detail,
  });
}

/** With `scheduleNext: false` (workflow paused mid-action) the pointer advances without scheduling: the resume kicks the run. */
export async function advanceRun(
  ctx: MutationCtx,
  run: Doc<'workflowRuns'>,
  workflow: Doc<'workflows'>,
  nextId: string | undefined,
  scheduleNext = true,
): Promise<void> {
  if (nextId === undefined) {
    await ctx.db.patch(run._id, {
      status: 'completed',
      finishedAt: Date.now(),
      currentNodeId: undefined,
      wakeAt: undefined,
      scheduledFnId: undefined,
    });
    await ctx.db.patch(workflow._id, {
      activeCount: Math.max(0, workflow.activeCount - 1),
      completedCount: workflow.completedCount + 1,
    });
    return;
  }
  await ctx.db.patch(run._id, {
    currentNodeId: nextId,
    wakeAt: undefined,
    scheduledFnId: undefined,
  });
  if (scheduleNext) {
    await ctx.scheduler.runAfter(0, internal.features.workflows.internal.executeStep, {
      runId: run._id,
      nodeId: nextId,
    });
  }
}

/** End a run before its path does: `failed` on a structural problem (removed node, deleted workflow…), `cancelled` when its contact is gone or someone stops it; `workflow` is null when the caller settles the counter itself. */
export async function endRun(
  ctx: MutationCtx,
  run: Doc<'workflowRuns'>,
  workflow: Doc<'workflows'> | null,
  status: 'failed' | 'cancelled',
  error?: string,
): Promise<void> {
  await ctx.db.patch(run._id, {
    status,
    finishedAt: Date.now(),
    currentNodeId: undefined,
    wakeAt: undefined,
    scheduledFnId: undefined,
    error,
  });
  if (workflow) {
    await ctx.db.patch(workflow._id, { activeCount: Math.max(0, workflow.activeCount - 1) });
  }
}

/** How many runs one transaction resumes or stops; the rest follows in a scheduled one. */
const RUN_BATCH = 200;

const activeRunsOf = (ctx: MutationCtx, workflowId: Id<'workflows'>) =>
  ctx.db
    .query('workflowRuns')
    .withIndex('by_workflow_status', (q) => q.eq('workflowId', workflowId).eq('status', 'active'));

/** Kicks a batch of the runs a pause parked and gives the cursor of the next, null after the last; a future wake keeps its scheduled call, and a duplicate kick is a no-op thanks to the guards of executeStep. */
export async function kickParkedRuns(
  ctx: MutationCtx,
  workflowId: Id<'workflows'>,
  cursor: string | null,
): Promise<string | null> {
  const page = await activeRunsOf(ctx, workflowId).paginate({ cursor, numItems: RUN_BATCH });
  const now = Date.now();
  for (const run of page.page) {
    if (!run.currentNodeId) continue;
    if (run.wakeAt !== undefined && run.wakeAt > now) continue;
    await ctx.scheduler.runAfter(0, internal.features.workflows.internal.executeStep, {
      runId: run._id,
      nodeId: run.currentNodeId,
    });
  }
  return page.isDone ? null : page.continueCursor;
}

/** Stops a batch of the runs of a workflow that is being deleted, and says whether some are left; the counter of the workflow is settled by the caller, once. */
export async function stopActiveRuns(
  ctx: MutationCtx,
  workflowId: Id<'workflows'>,
): Promise<boolean> {
  const runs = await activeRunsOf(ctx, workflowId).take(RUN_BATCH);
  for (const run of runs) await stopRun(ctx, run, null);
  return runs.length === RUN_BATCH;
}

/** Stop a run a person or a re-enrollment cancels: the wake it sleeps on is cancelled with it. */
export async function stopRun(
  ctx: MutationCtx,
  run: Doc<'workflowRuns'>,
  workflow: Doc<'workflows'> | null,
): Promise<void> {
  if (run.scheduledFnId) await ctx.scheduler.cancel(run.scheduledFnId);
  await endRun(ctx, run, workflow, 'cancelled');
}
