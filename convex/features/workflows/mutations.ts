import { v } from 'convex/values';
import { employeeMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import {
  createAuditFields,
  updateAuditFields,
  computeChanges,
  isNotDeleted,
  logAudit,
} from '../../lib';
import { advancedFilterValidator } from '../../_lib/validators/leadFilters';
import { workflowNodeValidator, workflowTriggerValidator } from '../../_lib/validators/workflows';
import { evalAdvancedFilter } from '../crm/leadMatching';
import { lightValidateGraph, validateWorkflowGraph } from './lib';
import { enrollLead } from './triggerDispatch';

/**
 * Public workflow management. All employees can manage workflows (same policy
 * as campaigns). Structural edits require the workflow to be paused so the
 * engine never reads a graph that changes under an executing run's feet.
 */

const PAUSE_FIRST = 'Mettez le workflow en pause avant de le modifier.';

async function getExistingWorkflow(
  ctx: MutationCtx,
  workflowId: Id<'workflows'>,
): Promise<Doc<'workflows'>> {
  const workflow = await ctx.db.get(workflowId);
  if (!workflow || !isNotDeleted(workflow)) throw new Error('workflow_not_found');
  return workflow;
}

const structuralArgs = {
  trigger: workflowTriggerValidator,
  enrollmentCriteria: v.optional(advancedFilterValidator),
  allowReEnrollment: v.boolean(),
  nodes: v.array(workflowNodeValidator),
  startNodeId: v.optional(v.string()),
};

export const createWorkflow = employeeMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    ...structuralArgs,
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error('Le nom du workflow est requis.');
    const graphError = lightValidateGraph(args.nodes, args.startNodeId);
    if (graphError) throw new Error(graphError);

    const workflowId = await ctx.db.insert('workflows', {
      name,
      description: args.description,
      status: 'draft',
      trigger: args.trigger,
      enrollmentCriteria: args.enrollmentCriteria,
      allowReEnrollment: args.allowReEnrollment,
      nodes: args.nodes,
      startNodeId: args.startNodeId,
      enrolledCount: 0,
      activeCount: 0,
      completedCount: 0,
      ...createAuditFields(ctx.userId),
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'workflow',
      entityId: workflowId,
      action: 'create',
    });
    return workflowId;
  },
});

/**
 * Full-replace update of a workflow (the editor saves its whole draft).
 * Structural fields are rejected while the workflow is active — pause first.
 */
export const updateWorkflow = employeeMutation({
  args: {
    workflowId: v.id('workflows'),
    name: v.string(),
    description: v.optional(v.string()),
    ...structuralArgs,
  },
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    const name = args.name.trim();
    if (!name) throw new Error('Le nom du workflow est requis.');

    const updates: Partial<Doc<'workflows'>> = {
      name,
      description: args.description,
      trigger: args.trigger,
      enrollmentCriteria: args.enrollmentCriteria,
      allowReEnrollment: args.allowReEnrollment,
      nodes: args.nodes,
      startNodeId: args.startNodeId,
    };
    const changes = computeChanges(workflow, updates);

    const structurallyChanged =
      changes &&
      ['trigger', 'enrollmentCriteria', 'allowReEnrollment', 'nodes', 'startNodeId'].some(
        (key) => key in changes,
      );
    if (structurallyChanged && workflow.status === 'active') {
      throw new Error(PAUSE_FIRST);
    }
    const graphError = lightValidateGraph(args.nodes, args.startNodeId);
    if (graphError) throw new Error(graphError);

    await ctx.db.patch(args.workflowId, { ...updates, ...updateAuditFields(ctx.userId) });

    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'workflow',
        entityId: args.workflowId,
        action: 'update',
        metadata: { changes },
      });
    }
    return args.workflowId;
  },
});

/**
 * Activate or pause a workflow. Activation runs the full graph validation
 * (French error on failure). Resuming (paused → active) re-kicks the runs that
 * were parked by the pause; runs still sleeping on a wait keep their pending
 * scheduled call, which finds the workflow active again at wake time.
 */
export const setWorkflowStatus = employeeMutation({
  args: {
    workflowId: v.id('workflows'),
    status: v.union(v.literal('active'), v.literal('paused')),
  },
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    if (workflow.status === args.status) return;

    if (args.status === 'active') {
      const defs = (await ctx.db.query('leadPropertyDefinitions').collect()).filter(isNotDeleted);
      const defsById = new Map(defs.map((d) => [d._id as string, d]));
      const lists = await ctx.db.query('leadLists').collect();
      const listIds = new Set<string>(lists.map((l) => l._id as string));
      const error = validateWorkflowGraph(workflow.nodes, workflow.startNodeId, defsById, listIds);
      if (error) throw new Error(error);
    }

    await ctx.db.patch(args.workflowId, { status: args.status, ...updateAuditFields(ctx.userId) });

    if (args.status === 'active' && workflow.status === 'paused') {
      const parked = await ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_status', (q) =>
          q.eq('workflowId', args.workflowId).eq('status', 'active'),
        )
        .collect();
      const now = Date.now();
      for (const run of parked) {
        // A future wake keeps its pending scheduled call; everything else was
        // halted by the pause and needs a kick. Duplicate kicks are no-ops
        // (stale-nodeId and pending-step guards in executeStep).
        if (!run.currentNodeId) continue;
        if (run.wakeAt !== undefined && run.wakeAt > now) continue;
        await ctx.scheduler.runAfter(0, internal.features.workflows.internal.executeStep, {
          runId: run._id,
          nodeId: run.currentNodeId,
        });
      }
    }

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'workflow',
      entityId: args.workflowId,
      action: 'update',
      metadata: { event: args.status === 'active' ? 'activate' : 'pause' },
    });
  },
});

/** Soft-delete a paused/draft workflow and cancel its in-flight runs. */
export const deleteWorkflow = employeeMutation({
  args: { workflowId: v.id('workflows') },
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    if (workflow.status === 'active') {
      throw new Error('Mettez le workflow en pause avant de le supprimer.');
    }

    const activeRuns = await ctx.db
      .query('workflowRuns')
      .withIndex('by_workflow_status', (q) =>
        q.eq('workflowId', args.workflowId).eq('status', 'active'),
      )
      .collect();
    for (const run of activeRuns) {
      if (run.scheduledFnId) await ctx.scheduler.cancel(run.scheduledFnId);
      await ctx.db.patch(run._id, {
        status: 'cancelled',
        finishedAt: Date.now(),
        currentNodeId: undefined,
        wakeAt: undefined,
        scheduledFnId: undefined,
      });
    }

    await ctx.db.patch(args.workflowId, {
      deletedAt: Date.now(),
      activeCount: 0,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'workflow',
      entityId: args.workflowId,
      action: 'delete',
    });
  },
});

/** Cancel one in-flight run (also the way out of a run stuck on a dead action). */
export const cancelRun = employeeMutation({
  args: { runId: v.id('workflowRuns') },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error('run_not_found');
    if (run.status !== 'active') throw new Error('Ce parcours est déjà terminé.');

    if (run.scheduledFnId) await ctx.scheduler.cancel(run.scheduledFnId);
    await ctx.db.patch(args.runId, {
      status: 'cancelled',
      finishedAt: Date.now(),
      currentNodeId: undefined,
      wakeAt: undefined,
      scheduledFnId: undefined,
    });
    const workflow = await ctx.db.get(run.workflowId);
    if (workflow) {
      await ctx.db.patch(workflow._id, { activeCount: Math.max(0, workflow.activeCount - 1) });
    }

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'workflowRun',
      entityId: args.runId,
      action: 'update',
      metadata: { event: 'cancel' },
    });
  },
});

/**
 * Bulk « réinscrire » after a save: enroll every non-deleted lead matching the
 * workflow's enrollment criteria (no criteria = every lead) into the current
 * graph. An explicit user action, so it deliberately bypasses the
 * allowReEnrollment setting and cancels in-flight runs (they were following
 * the old version) before re-enrolling. One transaction — fine at this CRM's
 * few-thousand-leads scale, same stance as listMatchingLeadIds' full scan.
 */
export const reenrollMatchingLeads = employeeMutation({
  args: { workflowId: v.id('workflows') },
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    if (workflow.status !== 'active' || !workflow.startNodeId) {
      throw new Error('Activez le workflow avant de réinscrire des leads.');
    }

    const leads = (await ctx.db.query('leads').collect()).filter(isNotDeleted);
    const matching = workflow.enrollmentCriteria
      ? leads.filter((lead) => evalAdvancedFilter(lead, workflow.enrollmentCriteria!))
      : leads;

    let cancelled = 0;
    let enrolled = 0;
    for (const lead of matching) {
      const runs = await ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) =>
          q.eq('workflowId', args.workflowId).eq('leadId', lead._id),
        )
        .collect();
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

    // Cancellations bypassed advanceRun, so fix activeCount once at the end:
    // it grew by `enrolled` (per-enroll bumps) but must shrink by `cancelled`.
    const fresh = await ctx.db.get(args.workflowId);
    if (fresh) {
      await ctx.db.patch(args.workflowId, {
        activeCount: Math.max(0, fresh.activeCount - cancelled),
        ...updateAuditFields(ctx.userId),
      });
    }

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'workflow',
      entityId: args.workflowId,
      action: 'update',
      metadata: { event: 'bulk_reenroll', matched: matching.length, enrolled, cancelled },
    });

    return { matched: matching.length, enrolled, cancelled };
  },
});

/**
 * Enroll a lead by hand (same rules as a trigger firing, minus the daily cap).
 * Doubles as the test facility while building a workflow.
 */
export const enrollLeadManually = employeeMutation({
  args: { workflowId: v.id('workflows'), leadId: v.id('leads') },
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    if (workflow.status !== 'active') {
      throw new Error('Activez le workflow avant d’inscrire un lead.');
    }
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) throw new Error('lead_not_found');

    const runs = await ctx.db
      .query('workflowRuns')
      .withIndex('by_workflow_lead', (q) =>
        q.eq('workflowId', args.workflowId).eq('leadId', args.leadId),
      )
      .collect();
    if (runs.some((r) => r.status === 'active')) {
      throw new Error('Ce lead a déjà un parcours en cours dans ce workflow.');
    }
    if (!workflow.allowReEnrollment && runs.length > 0) {
      throw new Error('Ce lead a déjà été inscrit dans ce workflow (réinscription désactivée).');
    }

    const runId = await enrollLead(ctx, workflow, args.leadId, 'manual', { manual: true });
    if (!runId) throw new Error('Ce workflow n’a pas de première étape.');

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'workflowRun',
      entityId: runId,
      action: 'create',
      metadata: { event: 'manual_enroll', workflowId: args.workflowId, leadId: args.leadId },
    });
    return runId;
  },
});
