import { paginationResultValidator } from 'convex/server';
import { docOf } from '../../lib/shared/docs';
import { workflowStatusValidator } from '../../_lib/validators/workflows';
import { workflowNodeValidator } from '../../_lib/validators/workflows';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { employeeQuery } from '../../_lib/auth';
import { isNotDeleted } from '../../lib/shared/db';
import { workflowRunStatusValidator } from '../../_lib/validators/workflows';

/** Public reads for the workflow pages. */

/** Summaries for the list page — counters are denormalized on the doc. */
export const listWorkflows = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('workflows'),
      _creationTime: v.number(),
      name: v.string(),
      description: v.optional(v.string()),
      status: workflowStatusValidator,
      triggerType: v.union(
        v.literal('lead_created'),
        v.literal('lead_property_changed'),
        v.literal('list_membership_changed'),
        v.literal('consent_updated'),
        v.literal('campaign_email_event'),
        v.literal('campaign_sms_event'),
        v.literal('tracked_link_click'),
        v.literal('score_threshold_crossed'),
        v.literal('form_submitted'),
        v.literal('deal_created'),
        v.literal('deal_stage_changed'),
        v.literal('deal_won'),
        v.literal('deal_lost'),
      ),
      allowReEnrollment: v.boolean(),
      nodeCount: v.number(),
      enrolledCount: v.number(),
      activeCount: v.number(),
      completedCount: v.number(),
      updatedAt: v.number(),
    }),
  ),
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
  returns: v.union(docOf('workflows'), v.null()),
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
  returns: paginationResultValidator(
    v.object({
      ...docOf('workflowRuns').fields,
      lead: v.union(
        v.object({
          _id: v.id('leads'),
          firstName: v.string(),
          lastName: v.string(),
          email: v.optional(v.string()),
        }),
        v.null(),
      ),
    }),
  ),
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
  returns: v.union(
    v.object({
      ...docOf('workflowRuns').fields,
      lead: v.union(
        v.object({
          _id: v.id('leads'),
          firstName: v.string(),
          lastName: v.string(),
          email: v.optional(v.string()),
        }),
        v.null(),
      ),
      workflow: v.union(
        v.object({
          _id: v.id('workflows'),
          name: v.string(),
          nodes: v.array(workflowNodeValidator),
        }),
        v.null(),
      ),
      steps: v.array(docOf('workflowRunSteps')),
    }),
    v.null(),
  ),
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
  returns: v.array(v.object({ ...docOf('workflowRuns').fields, workflowName: v.string() })),
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
