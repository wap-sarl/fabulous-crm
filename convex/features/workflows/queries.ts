import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { employeeQuery } from '../../_lib/auth';
import { isNotDeleted } from '../../lib';
import { workflowRunStatusValidator } from '../../_lib/validators/workflows';

/** Public reads for the workflow pages. */

/** Summaries for the list page — counters are denormalized on the doc. */
export const listWorkflows = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const workflows = (await ctx.db.query('workflows').collect()).filter(isNotDeleted);
    return workflows
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((w) => ({
        _id: w._id,
        _creationTime: w._creationTime,
        name: w.name,
        description: w.description,
        status: w.status,
        triggerType: w.trigger.type,
        allowReEnrollment: w.allowReEnrollment,
        nodeCount: w.nodes.length,
        enrolledCount: w.enrolledCount,
        activeCount: w.activeCount,
        completedCount: w.completedCount,
        updatedAt: w.updatedAt,
      }));
  },
});

/** The full workflow doc — the editor edits exactly this shape. */
export const getWorkflow = employeeQuery({
  args: { workflowId: v.id('workflows') },
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow || !isNotDeleted(workflow)) return null;
    return workflow;
  },
});

/** Paginated run history of a workflow, newest first, with a lead summary. */
export const listRuns = employeeQuery({
  args: {
    workflowId: v.id('workflows'),
    status: v.optional(workflowRunStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const page = await (args.status !== undefined
      ? ctx.db
          .query('workflowRuns')
          .withIndex('by_workflow_status', (q) =>
            q.eq('workflowId', args.workflowId).eq('status', args.status!),
          )
      : ctx.db
          .query('workflowRuns')
          .withIndex('by_workflow', (q) => q.eq('workflowId', args.workflowId))
    )
      .order('desc')
      .paginate(args.paginationOpts);

    const runs = await Promise.all(
      page.page.map(async (run) => {
        const lead = await ctx.db.get(run.leadId);
        return {
          ...run,
          lead: lead
            ? {
                _id: lead._id,
                firstName: lead.firstName,
                lastName: lead.lastName,
                email: lead.email,
              }
            : null,
        };
      }),
    );
    return { ...page, page: runs };
  },
});

/** One run with its full step log and enough workflow context to label nodes. */
export const getRun = employeeQuery({
  args: { runId: v.id('workflowRuns') },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const [workflow, lead, steps] = await Promise.all([
      ctx.db.get(run.workflowId),
      ctx.db.get(run.leadId),
      ctx.db
        .query('workflowRunSteps')
        .withIndex('by_run', (q) => q.eq('runId', args.runId))
        .collect(),
    ]);
    return {
      ...run,
      lead: lead
        ? { _id: lead._id, firstName: lead.firstName, lastName: lead.lastName, email: lead.email }
        : null,
      workflow: workflow ? { _id: workflow._id, name: workflow.name, nodes: workflow.nodes } : null,
      steps: steps.sort((a, b) => a.startedAt - b.startedAt),
    };
  },
});

/** A lead's enrollment history across workflows (lead-page panel). */
export const listRunsForLead = employeeQuery({
  args: { leadId: v.id('leads') },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query('workflowRuns')
      .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
      .collect();
    const withWorkflow = await Promise.all(
      runs.map(async (run) => {
        const workflow = await ctx.db.get(run.workflowId);
        return { ...run, workflowName: workflow?.name ?? 'Workflow supprimé' };
      }),
    );
    return withWorkflow.sort((a, b) => b.enrolledAt - a.enrolledAt);
  },
});
