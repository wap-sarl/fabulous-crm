import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import { extensions } from '../../extensions';
import { isNotDeleted } from '../shared/db';
import { evalAdvancedFilter } from '../leads/matching';
import { loadLeadFilterExtras } from '../leads/tableFilters';
import {
  matchesTrigger,
  MAX_ENROLLMENTS_PER_LEAD_PER_DAY,
  type WorkflowTriggerEvent,
} from './rules';
import { DAY_MS } from '../../_lib/time';

/** The dispatch runs inline in the host mutation's transaction but never throws into it: an automation failure must not break a lead edit. */

/** The active, non-deleted workflows. Tiny table — read in full like leadLists. */
export async function loadActiveWorkflows(ctx: MutationCtx): Promise<Doc<'workflows'>[]> {
  const all = await ctx.db.query('workflows').collect();
  return all.filter((w) => isNotDeleted(w) && w.status === 'active');
}

/** Assumes every enrollment check already passed: the callers own the rules. */
export async function enrollLead(
  ctx: MutationCtx,
  workflow: Doc<'workflows'>,
  leadId: Id<'leads'>,
  triggerType: string,
  opts?: { manual?: boolean },
): Promise<Id<'workflowRuns'> | null> {
  if (!workflow.startNodeId) return null;
  if (!(await extensions.beforeWorkflowRun(ctx, workflow))) return null;

  const runId = await ctx.db.insert('workflowRuns', {
    workflowId: workflow._id,
    leadId,
    status: 'active',
    triggerType,
    manual: opts?.manual ? true : undefined,
    enrolledAt: Date.now(),
    currentNodeId: workflow.startNodeId,
    stepCount: 0,
  });
  // Read again: bulk callers enroll several leads in one transaction, and patching from the captured doc would clobber the previous increments.
  const fresh = (await ctx.db.get(workflow._id)) ?? workflow;
  await ctx.db.patch(workflow._id, {
    enrolledCount: fresh.enrolledCount + 1,
    activeCount: fresh.activeCount + 1,
  });
  await ctx.scheduler.runAfter(0, internal.features.workflows.internal.executeStep, {
    runId,
    nodeId: workflow.startNodeId,
  });
  return runId;
}

/** `opts.source` names the run whose action caused the event, so a workflow never enrolls itself; `opts.workflows` lets a bulk caller load the workflows once. */
export async function dispatchWorkflowTrigger(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  event: WorkflowTriggerEvent,
  opts?: {
    source?: { runId: Id<'workflowRuns'>; workflowId: Id<'workflows'> };
    workflows?: Doc<'workflows'>[];
  },
): Promise<void> {
  try {
    const workflows = (opts?.workflows ?? (await loadActiveWorkflows(ctx))).filter((w) =>
      matchesTrigger(w.trigger, event),
    );
    if (workflows.length === 0) return;

    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt !== undefined) return;

    for (const workflow of workflows) {
      // A workflow's own actions (property writes, list moves) never re-enroll it.
      if (opts?.source?.workflowId === workflow._id) continue;

      if (workflow.enrollmentCriteria) {
        const extras = await loadLeadFilterExtras(ctx, leadId, workflow.enrollmentCriteria);
        if (!evalAdvancedFilter(lead, workflow.enrollmentCriteria, extras)) continue;
      }

      const runs = await ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) => q.eq('workflowId', workflow._id).eq('leadId', leadId))
        .collect();
      if (runs.some((r) => r.status === 'active')) continue;
      if (!workflow.allowReEnrollment && runs.length > 0) continue;

      // Bounds cross-workflow ping-pong (A's action triggers B, B's triggers A…).
      const dayAgo = Date.now() - DAY_MS;
      if (runs.filter((r) => r.enrolledAt > dayAgo).length >= MAX_ENROLLMENTS_PER_LEAD_PER_DAY) {
        console.warn('workflow enrollment cap reached', workflow._id, leadId);
        continue;
      }

      await enrollLead(ctx, workflow, leadId, event.type);
    }
  } catch (error) {
    // Never propagate into the host mutation — automations are best-effort.
    console.error('workflow trigger dispatch failed', error);
  }
}
