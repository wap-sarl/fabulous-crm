import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
// Trigger-wrapped constructor: keeps the lead aggregates in sync (functions.ts).
import { internalMutation } from '../../_lib/functions';
import { internal } from '../../_generated/api';
import { logAudit } from '../../lib/audit/log';
import { isNotDeleted } from '../../lib/shared/db';
import { evalAdvancedFilter } from '../../lib/leads/matching';
import { loadLeadFilterExtras } from '../../lib/leads/tableFilters';
import { workflowStepOutcomeValidator } from '../../_lib/validators/workflows';
import { MAX_ENROLLMENTS_PER_LEAD_PER_DAY, MAX_STEPS_PER_RUN } from '../../lib/workflows/rules';
import { enrollLead } from '../../lib/workflows/dispatch';
import { advanceRun, endRun, type StepContext } from '../../lib/workflows/runs';
import { createDealStep, updateDealStageStep } from '../../lib/workflows/steps/deals';
import { branchStep, waitStep } from '../../lib/workflows/steps/flow';
import { setLifecycleStageStep, updatePropertyStep } from '../../lib/workflows/steps/lead';
import { addToListStep, removeFromListStep } from '../../lib/workflows/steps/lists';
import {
  type ActionStepContext,
  actionStepContextOf,
  sendEmailStep,
  sendSmsStep,
  webhookStep,
} from '../../lib/workflows/steps/sends';
import { createTaskStep } from '../../lib/workflows/steps/tasks';
import { deferUnlessAllowed } from '../../lib/extensions/gates';
import { DAY_MS } from '../../_lib/time';

/** The engine runs one node per transaction, chained through the scheduler: the step log is visible live and a crash never loses more than one step. */

/** A run only ever executes its `currentNodeId`, exactly once: duplicate or stale schedules are no-ops, so pause, resume and replays are safe. */
export const executeStep = internalMutation({
  args: { runId: v.id('workflowRuns'), nodeId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const run = await ctx.db.get(args.runId);
    if (run?.status !== 'active') return;
    // Stale schedule (the run already advanced past this node) — no-op.
    if (run.currentNodeId !== args.nodeId) return;

    const workflow = await ctx.db.get(run.workflowId);
    if (!workflow || workflow.deletedAt !== undefined) {
      await endRun(
        ctx,
        run,
        workflow?.deletedAt !== undefined ? workflow : null,
        'failed',
        'workflow_deleted',
      );
      return;
    }
    // Paused: leave the run parked; setWorkflowStatus re-kicks it on resume.
    if (workflow.status !== 'active') return;
    // Deferred (e.g. a suspended deployment): the step runs again later, the run stays parked here.
    if (
      await deferUnlessAllowed(
        ctx,
        'workflow_step',
        internal.features.workflows.internal.executeStep,
        args,
      )
    ) {
      return;
    }

    // An async action is still in flight (e.g. resume clicked during a send): completeActionStep will advance the run.
    const steps = await ctx.db
      .query('workflowRunSteps')
      .withIndex('by_run', (q) => q.eq('runId', run._id))
      .collect();
    if (steps.some((s) => s.status === 'pending')) return;

    const node = workflow.nodes.find((n) => n.id === args.nodeId);
    if (!node) {
      await endRun(ctx, run, workflow, 'failed', 'step_removed');
      return;
    }
    if (run.stepCount >= MAX_STEPS_PER_RUN) {
      await endRun(ctx, run, workflow, 'failed', 'step_limit');
      return;
    }

    const lead = await ctx.db.get(run.leadId);
    if (!lead || lead.deletedAt !== undefined) {
      await endRun(ctx, run, workflow, 'cancelled', 'lead_supprime');
      return;
    }

    await ctx.db.patch(run._id, { stepCount: run.stepCount + 1 });
    const step: StepContext = {
      ctx,
      run,
      workflow,
      lead,
      source: { runId: run._id, workflowId: workflow._id },
    };

    switch (node.type) {
      case 'branch':
        return await branchStep(step, node);
      case 'wait':
        return await waitStep(step, node);
      case 'update_property':
        return await updatePropertyStep(step, node);
      case 'set_lifecycle_stage':
        return await setLifecycleStageStep(step, node);
      case 'create_deal':
        return await createDealStep(step, node);
      case 'create_task':
        return await createTaskStep(step, node);
      case 'update_deal_stage':
        return await updateDealStageStep(step, node);
      case 'add_to_list':
        return await addToListStep(step, node);
      case 'remove_from_list':
        return await removeFromListStep(step, node);
      case 'send_email':
        return await sendEmailStep(step, node);
      case 'send_sms':
        return await sendSmsStep(step, node);
      case 'webhook':
        return await webhookStep(step, node);
    }
  },
});

/** Null when the run or the node is no longer actionable (cancelled meanwhile, node edited away): the action then completes the step as skipped. */
export const getActionStepContext = internalQuery({
  args: { runId: v.id('workflowRuns'), stepId: v.id('workflowRunSteps'), nodeId: v.string() },
  handler: async (ctx, args): Promise<ActionStepContext> => {
    const run = await ctx.db.get(args.runId);
    if (run?.status !== 'active' || run.currentNodeId !== args.nodeId) return null;
    const workflow = await ctx.db.get(run.workflowId);
    if (!workflow || workflow.deletedAt !== undefined) return null;
    const node = workflow.nodes.find((n) => n.id === args.nodeId);
    if (!node) return null;
    const lead = await ctx.db.get(run.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;

    return await actionStepContextOf(ctx, run, workflow, node, lead);
  },
});

/** The step already happened externally, so the pointer always advances; the next step is scheduled only while the workflow is active. */
export const completeActionStep = internalMutation({
  args: {
    runId: v.id('workflowRuns'),
    stepId: v.id('workflowRunSteps'),
    nodeId: v.string(),
    status: workflowStepOutcomeValidator,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const step = await ctx.db.get(args.stepId);
    if (step && step.status === 'pending') {
      await ctx.db.patch(args.stepId, {
        status: args.status,
        detail: args.detail,
        finishedAt: Date.now(),
      });
    }

    const run = await ctx.db.get(args.runId);
    if (run?.status !== 'active' || run.currentNodeId !== args.nodeId) return;
    const workflow = await ctx.db.get(run.workflowId);
    if (!workflow || workflow.deletedAt !== undefined) {
      await endRun(ctx, run, workflow ?? null, 'failed', 'workflow_deleted');
      return;
    }
    const node = workflow.nodes.find((n) => n.id === args.nodeId);
    if (!node) {
      await endRun(ctx, run, workflow, 'failed', 'step_removed');
      return;
    }
    const next = node.type === 'branch' ? undefined : node.next;
    await advanceRun(ctx, run, workflow, next, workflow.status === 'active');
  },
});

// Leads per transaction: each one reads its runs and writes a cancellation, a run and counter patches, which stays far below the transaction limits.
const REENROLL_BATCH = 100;

export const reenrollBatch = internalMutation({
  args: { workflowId: v.id('workflows'), cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ isDone: boolean; continueCursor: string | null }> => {
    const workflow = await ctx.db.get(args.workflowId);
    if (
      !workflow ||
      workflow.deletedAt != null ||
      workflow.status !== 'active' ||
      workflow.bulkReenroll?.status !== 'running'
    ) {
      return { isDone: true, continueCursor: null };
    }

    const page = await ctx.db
      .query('leads')
      .paginate({ cursor: args.cursor ?? null, numItems: REENROLL_BATCH });

    const dayAgo = Date.now() - DAY_MS;
    let matched = 0;
    let enrolled = 0;
    let cancelled = 0;
    let skipped = 0;
    for (const lead of page.page) {
      if (!isNotDeleted(lead)) continue;
      if (workflow.enrollmentCriteria) {
        const extras = await loadLeadFilterExtras(ctx, lead._id, workflow.enrollmentCriteria);
        if (!evalAdvancedFilter(lead, workflow.enrollmentCriteria, extras)) continue;
      }
      matched++;

      const runs = await ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) =>
          q.eq('workflowId', args.workflowId).eq('leadId', lead._id),
        )
        .collect();

      // The daily cap is checked before cancelling anything: a capped lead keeps its in-flight run instead of losing it for nothing.
      if (runs.filter((r) => r.enrolledAt > dayAgo).length >= MAX_ENROLLMENTS_PER_LEAD_PER_DAY) {
        skipped++;
        continue;
      }

      for (const run of runs) {
        if (run.status !== 'active') continue;
        if (run.scheduledFnId) await ctx.scheduler.cancel(run.scheduledFnId);
        await ctx.db.patch(run._id, {
          status: 'cancelled',
          finishedAt: Date.now(),
          currentNodeId: undefined,
          wakeAt: undefined,
          scheduledFnId: undefined,
        });
        cancelled++;
      }

      const runId = await enrollLead(ctx, workflow, lead._id, 'bulk_reenroll');
      if (runId) enrolled++;
    }

    // Read again: enrollLead patched the counters above, and the cancellations bypassed advanceRun, so activeCount shrinks by `cancelled` here.
    const fresh = await ctx.db.get(args.workflowId);
    if (fresh?.bulkReenroll?.status !== 'running') {
      return { isDone: true, continueCursor: null };
    }
    const progress = {
      status: 'running' as const,
      startedBy: fresh.bulkReenroll.startedBy,
      matched: fresh.bulkReenroll.matched + matched,
      enrolled: fresh.bulkReenroll.enrolled + enrolled,
      cancelled: fresh.bulkReenroll.cancelled + cancelled,
      skipped: fresh.bulkReenroll.skipped + skipped,
      startedAt: fresh.bulkReenroll.startedAt,
    };
    if (!page.isDone) {
      await ctx.db.patch(args.workflowId, {
        activeCount: Math.max(0, fresh.activeCount - cancelled),
        bulkReenroll: progress,
      });
      await ctx.scheduler.runAfter(0, internal.features.workflows.internal.reenrollBatch, {
        workflowId: args.workflowId,
        cursor: page.continueCursor,
      });
      return { isDone: false, continueCursor: page.continueCursor };
    }

    await ctx.db.patch(args.workflowId, {
      activeCount: Math.max(0, fresh.activeCount - cancelled),
      bulkReenroll: { ...progress, status: 'done', finishedAt: Date.now() },
    });
    await logAudit({
      ctx,
      userId: progress.startedBy,
      entityType: 'workflow',
      entityId: args.workflowId,
      action: 'update',
      metadata: {
        event: 'bulk_reenroll',
        matched: progress.matched,
        enrolled: progress.enrolled,
        cancelled: progress.cancelled,
        skipped: progress.skipped,
      },
    });
    return { isDone: true, continueCursor: page.continueCursor };
  },
});
