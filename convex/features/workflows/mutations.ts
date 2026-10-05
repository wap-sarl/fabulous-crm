import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import { employeeMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import {
  createAuditFields,
  updateAuditFields,
  computeChanges,
  logAudit,
} from '../../lib/audit/log';
import { isNotDeleted } from '../../lib/shared/db';
import { leadAdvancedFilterValidator } from '../../_lib/validators/filters';
import { workflowNodeValidator, workflowTriggerValidator } from '../../_lib/validators/workflows';
import { lightValidateGraph } from '../../lib/workflows/rules';
import { activationIssue } from '../../lib/workflows/activation';
import { enrollLead } from '../../lib/workflows/dispatch';
import { kickParkedRuns, stopActiveRuns, stopRun } from '../../lib/workflows/runs';

/** Every employee manages workflows, as for campaigns; a structural edit requires a pause, so the engine never reads a graph that changes under a run. */

const PAUSE_FIRST = 'Mettez le workflow en pause avant de le modifier.';
const NAME_REQUIRED = 'Le nom du workflow est requis.';

async function getExistingWorkflow(
  ctx: MutationCtx,
  workflowId: Id<'workflows'>,
): Promise<Doc<'workflows'>> {
  const workflow = await ctx.db.get(workflowId);
  if (!workflow || !isNotDeleted(workflow)) throw refusal('workflow_not_found');
  return workflow;
}

const structuralArgs = {
  trigger: workflowTriggerValidator,
  enrollmentCriteria: v.optional(leadAdvancedFilterValidator),
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
  returns: v.id('workflows'),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw refusal('workflow_name_required', { message: NAME_REQUIRED });
    const graphError = lightValidateGraph(args.nodes, args.startNodeId);
    if (graphError) throw refusal('workflow_graph_invalid', { message: graphError });

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

/** The editor saves its whole draft, so this replaces everything; a structural change is refused while the workflow is active. */
export const updateWorkflow = employeeMutation({
  args: {
    workflowId: v.id('workflows'),
    name: v.string(),
    description: v.optional(v.string()),
    ...structuralArgs,
  },
  returns: v.id('workflows'),
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    const name = args.name.trim();
    if (!name) throw refusal('workflow_name_required', { message: NAME_REQUIRED });

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
      throw refusal('workflow_pause_first', { message: PAUSE_FIRST });
    }
    const graphError = lightValidateGraph(args.nodes, args.startNodeId);
    if (graphError) throw refusal('workflow_graph_invalid', { message: graphError });

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

/** Activation validates the whole graph; a resume kicks the runs the pause parked, while a run sleeping on a wait keeps its scheduled call. */
export const setWorkflowStatus = employeeMutation({
  args: {
    workflowId: v.id('workflows'),
    status: v.union(v.literal('active'), v.literal('paused')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    if (workflow.status === args.status) return null;

    if (args.status === 'active') {
      const error = await activationIssue(ctx, workflow);
      if (error) throw refusal('workflow_graph_invalid', { message: error });
    }

    await ctx.db.patch(args.workflowId, { status: args.status, ...updateAuditFields(ctx.userId) });

    if (args.status === 'active' && workflow.status === 'paused') {
      const cursor = await kickParkedRuns(ctx, args.workflowId, null);
      if (cursor !== null) {
        await ctx.scheduler.runAfter(0, internal.features.workflows.internal.resumeParkedRuns, {
          workflowId: args.workflowId,
          cursor,
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
    return null;
  },
});

/** Soft-delete a paused/draft workflow and cancel its in-flight runs. */
export const deleteWorkflow = employeeMutation({
  args: { workflowId: v.id('workflows') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    if (workflow.status === 'active') {
      throw refusal('workflow_pause_first', {
        message: 'Mettez le workflow en pause avant de le supprimer.',
      });
    }

    // The counter is settled once below, for all of them.
    if (await stopActiveRuns(ctx, args.workflowId)) {
      await ctx.scheduler.runAfter(0, internal.features.workflows.internal.stopRemainingRuns, {
        workflowId: args.workflowId,
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
    return null;
  },
});

/** Cancel one in-flight run (also the way out of a run stuck on a dead action). */
export const cancelRun = employeeMutation({
  args: { runId: v.id('workflowRuns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw refusal('run_not_found');
    if (run.status !== 'active') {
      throw refusal('workflow_run_finished', { message: 'Ce parcours est déjà terminé.' });
    }

    await stopRun(ctx, run, await ctx.db.get(run.workflowId));

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'workflowRun',
      entityId: args.runId,
      action: 'update',
      metadata: { event: 'cancel' },
    });
    return null;
  },
});

/** An explicit user action, so it bypasses allowReEnrollment on purpose and cancels the in-flight runs, which follow the previous graph. */
export const reenrollMatchingLeads = employeeMutation({
  args: { workflowId: v.id('workflows') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    if (workflow.status !== 'active' || !workflow.startNodeId) {
      throw refusal('workflow_not_active', {
        message: 'Activez le workflow avant de réinscrire des leads.',
      });
    }
    if (workflow.bulkReenroll?.status === 'running') {
      throw refusal('workflow_reenroll_running', {
        message: 'Une réinscription est déjà en cours pour ce workflow.',
      });
    }

    await ctx.db.patch(args.workflowId, {
      bulkReenroll: {
        status: 'running',
        startedBy: ctx.userId,
        matched: 0,
        enrolled: 0,
        cancelled: 0,
        skipped: 0,
        startedAt: Date.now(),
      },
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAfter(0, internal.features.workflows.internal.reenrollBatch, {
      workflowId: args.workflowId,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'workflow',
      entityId: args.workflowId,
      action: 'update',
      metadata: { event: 'bulk_reenroll_started' },
    });
    return null;
  },
});

/** Same rules as a trigger firing, minus the daily cap: this is also how a workflow is tested while it is built. */
export const enrollLeadManually = employeeMutation({
  args: { workflowId: v.id('workflows'), leadId: v.id('leads') },
  returns: v.id('workflowRuns'),
  handler: async (ctx, args) => {
    const workflow = await getExistingWorkflow(ctx, args.workflowId);
    if (workflow.status !== 'active') {
      throw refusal('workflow_not_active', {
        message: 'Activez le workflow avant d’inscrire un lead.',
      });
    }
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) throw refusal('lead_not_found');

    const runs = await ctx.db
      .query('workflowRuns')
      .withIndex('by_workflow_lead', (q) =>
        q.eq('workflowId', args.workflowId).eq('leadId', args.leadId),
      )
      .collect();
    if (runs.some((r) => r.status === 'active')) {
      throw refusal('workflow_run_active', {
        message: 'Ce lead a déjà un parcours en cours dans ce workflow.',
      });
    }
    if (!workflow.allowReEnrollment && runs.length > 0) {
      throw refusal('workflow_reenrollment_disabled', {
        message: 'Ce lead a déjà été inscrit dans ce workflow (réinscription désactivée).',
      });
    }

    const runId = await enrollLead(ctx, workflow, args.leadId, 'manual', { manual: true });
    if (!runId) {
      throw refusal('workflow_no_first_step', {
        message: 'Ce workflow n’a pas de première étape.',
      });
    }

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
