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

/** End a run before its path does: `failed` on a structural problem (removed node, deleted workflow…), `cancelled` when its contact is gone. */
export async function endRun(
  ctx: MutationCtx,
  run: Doc<'workflowRuns'>,
  workflow: Doc<'workflows'> | null,
  status: 'failed' | 'cancelled',
  error: string,
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
