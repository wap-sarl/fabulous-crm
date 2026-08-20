import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import { isNotDeleted } from '../../lib';
import { evalAdvancedFilter } from '../crm/leadMatching';
import {
  matchesTrigger,
  MAX_ENROLLMENTS_PER_LEAD_PER_DAY,
  type WorkflowTriggerEvent,
} from './lib';

/**
 * The single entry point CRM mutations call when a triggerable event happens
 * on a lead. Finds the active workflows whose trigger matches, applies the
 * enrollment rules and enrolls. Runs inline in the host mutation's transaction
 * but NEVER throws into it — an automation failure must not break a lead edit.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The active, non-deleted workflows. Tiny table — read in full like leadLists. */
export async function loadActiveWorkflows(ctx: MutationCtx): Promise<Doc<'workflows'>[]> {
  const all = await ctx.db.query('workflows').collect();
  return all.filter((w) => isNotDeleted(w) && w.status === 'active');
}

/**
 * Insert a run for `lead` in `workflow` and schedule its first step. Assumes
 * every enrollment check already passed. Shared by the dispatcher and
 * `enrollLeadManually`.
 */
export async function enrollLead(
  ctx: MutationCtx,
  workflow: Doc<'workflows'>,
  leadId: Id<'leads'>,
  triggerType: string,
  opts?: { manual?: boolean }
): Promise<Id<'workflowRuns'> | null> {
  if (!workflow.startNodeId) return null;

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
  // Re-read before bumping: bulk callers (CSV import, mass re-enroll) enroll
  // several leads in one transaction, and patching from the captured doc would
  // clobber the previous increments.
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

/**
 * Dispatch a trigger event for a lead. `opts.source` identifies the workflow
 * run whose own action caused the event, so a workflow never re-enrolls itself
 * from its own side effects. `opts.workflows` lets bulk callers (CSV import)
 * preload the active workflows once for the whole loop.
 */
export async function dispatchWorkflowTrigger(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  event: WorkflowTriggerEvent,
  opts?: {
    source?: { runId: Id<'workflowRuns'>; workflowId: Id<'workflows'> };
    workflows?: Doc<'workflows'>[];
  }
): Promise<void> {
  try {
    const workflows = (opts?.workflows ?? (await loadActiveWorkflows(ctx))).filter((w) =>
      matchesTrigger(w.trigger, event)
    );
    if (workflows.length === 0) return;

    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt !== undefined) return;

    for (const workflow of workflows) {
      // A workflow's own actions (property writes, list moves) never re-enroll it.
      if (opts?.source?.workflowId === workflow._id) continue;

      if (workflow.enrollmentCriteria && !evalAdvancedFilter(lead, workflow.enrollmentCriteria)) {
        continue;
      }

      const runs = await ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) =>
          q.eq('workflowId', workflow._id).eq('leadId', leadId)
        )
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
