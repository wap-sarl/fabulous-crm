import { type Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';
import { advancedFilterValidator, filterFieldValidator } from './leadFilters';
import { trackedLinkStandardFieldValidator } from './crm';
import { leadPropertyValueValidator } from './leadProperties';

/**
 * HubSpot-style workflow automation on leads. A workflow is an enrollment
 * trigger (an event, optionally refined by the shared advanced filter) plus a
 * tree of step nodes (actions, waits, if/else branches). Enrollments are
 * tracked as workflowRuns; each executed step is one workflowRunSteps row.
 */

/** Email engagement events (campaignEvents) that can enroll a lead. */
export const workflowEmailEventValidator = v.union(
  v.literal('delivered'),
  v.literal('opened'),
  v.literal('clicked'),
  v.literal('hard_bounce'),
  v.literal('soft_bounce'),
  v.literal('unsubscribed'),
);

/** SMS engagement events that can enroll a lead. `stop` = STOP reply opt-out. */
export const workflowSmsEventValidator = v.union(
  v.literal('delivered'),
  v.literal('sms_reply'),
  v.literal('stop'),
);

/**
 * The enrollment trigger, discriminated on `type`. Optional refinement fields
 * left unset mean "any" (any list, any campaign, any changed field); finer
 * targeting belongs in `enrollmentCriteria` on the workflow.
 */
export const workflowTriggerValidator = v.union(
  v.object({ type: v.literal('lead_created') }),
  v.object({
    type: v.literal('lead_property_changed'),
    // Unset = any filterable field change enrolls.
    watchedFields: v.optional(v.array(filterFieldValidator)),
  }),
  v.object({
    type: v.literal('list_membership_changed'),
    change: v.union(v.literal('added'), v.literal('removed')),
    listId: v.optional(v.id('leadLists')),
  }),
  v.object({ type: v.literal('consent_updated') }),
  v.object({
    type: v.literal('campaign_email_event'),
    event: workflowEmailEventValidator,
    campaignId: v.optional(v.id('campaigns')),
  }),
  v.object({
    type: v.literal('campaign_sms_event'),
    event: workflowSmsEventValidator,
    campaignId: v.optional(v.id('campaigns')),
  }),
  v.object({
    type: v.literal('tracked_link_click'),
    campaignId: v.optional(v.id('campaigns')),
    linkKey: v.optional(v.string()),
  }),
);

/**
 * Target of an `update_property` node — a built-in lead column or a custom
 * property definition. Same shape (and exclusions) as campaign tracked links:
 * no `marketingConsent`, `assignedTo` or `address`.
 */
export const workflowLeadTargetValidator = v.union(
  v.object({ kind: v.literal('standard'), field: trackedLinkStandardFieldValidator }),
  v.object({ kind: v.literal('custom'), propertyDefId: v.id('leadPropertyDefinitions') }),
);

export const workflowWaitUnitValidator = v.union(
  v.literal('minutes'),
  v.literal('hours'),
  v.literal('days'),
);

const nodeBase = {
  // Client-generated id, unique within the workflow. Node references
  // (`next`/`nextTrue`/`nextFalse`) point at these ids; an unset reference
  // means the run completes on that path.
  id: v.string(),
  // Persisted editor position. The engine ignores it; the frontend recomputes
  // layout anyway, so it is only kept to round-trip cleanly.
  position: v.optional(v.object({ x: v.number(), y: v.number() })),
};

/**
 * One step of the graph, discriminated on `type`. The graph is a strict tree
 * (validated cycle-free at activation): every node is referenced by at most
 * one parent slot, starting from the workflow's `startNodeId`.
 */
export const workflowNodeValidator = v.union(
  v.object({
    ...nodeBase,
    type: v.literal('send_email'),
    subject: v.string(),
    htmlBody: v.string(),
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('send_sms'),
    smsBody: v.string(),
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('update_property'),
    target: workflowLeadTargetValidator,
    value: leadPropertyValueValidator,
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('add_to_list'),
    // Optional so an unconfigured draft can be saved; required to activate.
    listId: v.optional(v.id('leadLists')),
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('remove_from_list'),
    listId: v.optional(v.id('leadLists')),
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('wait'),
    amount: v.number(),
    unit: workflowWaitUnitValidator,
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('webhook'),
    url: v.string(),
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('branch'),
    // Evaluated against the lead when the run reaches this node. A condition
    // with no active rule is neutral and evaluates true (evalAdvancedFilter
    // semantics).
    condition: advancedFilterValidator,
    nextTrue: v.optional(v.string()),
    nextFalse: v.optional(v.string()),
  }),
);

export const workflowStatusValidator = v.union(
  v.literal('draft'),
  v.literal('active'),
  v.literal('paused'),
);

export const workflowValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  name: v.string(),
  description: v.optional(v.string()),
  // Only 'active' workflows enroll and execute. Structural fields (trigger,
  // criteria, nodes) are only editable while 'draft' or 'paused'.
  status: workflowStatusValidator,
  trigger: workflowTriggerValidator,
  // Extra AND/OR conditions a lead must match at trigger time to be enrolled.
  enrollmentCriteria: v.optional(advancedFilterValidator),
  // false = a lead can only ever be enrolled once. Either way a lead is never
  // enrolled while it already has an active run in this workflow.
  allowReEnrollment: v.boolean(),
  nodes: v.array(workflowNodeValidator),
  // First node executed on enrollment. Optional so drafts can be saved empty;
  // required (and validated) at activation.
  startNodeId: v.optional(v.string()),
  // Denormalized counters, bumped on enroll/finish so the list view stays
  // O(#workflows) with no run scans.
  enrolledCount: v.number(),
  activeCount: v.number(),
  completedCount: v.number(),
  bulkReenroll: v.optional(
    v.object({
      status: v.union(v.literal('running'), v.literal('done')),
      startedBy: v.id('users'),
      matched: v.number(),
      enrolled: v.number(),
      cancelled: v.number(),
      // Leads skipped because they hit MAX_ENROLLMENTS_PER_LEAD_PER_DAY.
      skipped: v.number(),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
    }),
  ),
});

export const workflowRunStatusValidator = v.union(
  v.literal('active'),
  v.literal('completed'),
  v.literal('cancelled'),
  v.literal('failed'),
);

/** One enrollment of a lead in a workflow. */
export const workflowRunValidator = v.object({
  workflowId: v.id('workflows'),
  leadId: v.id('leads'),
  status: workflowRunStatusValidator,
  // Snapshot of trigger.type at enrollment ('manual' for manual enrollments)
  // so the history explains why the lead entered even after trigger edits.
  triggerType: v.string(),
  manual: v.optional(v.boolean()),
  enrolledAt: v.number(),
  finishedAt: v.optional(v.number()),
  // Node to execute next. Unset once the run is finished. While parked on a
  // wait, this is already the post-wait node (the sleep is scheduled).
  currentNodeId: v.optional(v.string()),
  // Executed-step counter guarding against runaway graphs (MAX_STEPS_PER_RUN).
  stepCount: v.number(),
  // Set while parked on a wait: wake time + the pending scheduled function,
  // kept so cancelRun/deleteWorkflow can cancel the sleep.
  wakeAt: v.optional(v.number()),
  scheduledFnId: v.optional(v.id('_scheduled_functions')),
  // Failure reason when status === 'failed' (e.g. 'step_removed').
  error: v.optional(v.string()),
});

/**
 * Outcome of one executed step. 'pending' only while an async action (send,
 * webhook) is in flight. Skips record why a step was passed over without
 * failing the run; 'failed' (provider error, webhook non-2xx) also lets the
 * run continue — only structural problems fail the run itself.
 */
export const workflowStepOutcomeValidator = v.union(
  v.literal('pending'),
  v.literal('success'),
  v.literal('failed'),
  v.literal('skipped_no_consent'),
  v.literal('skipped_no_email'),
  v.literal('skipped_no_phone'),
  v.literal('skipped'),
);

/** Append-only log: one row per step a run executed. */
export const workflowRunStepValidator = v.object({
  runId: v.id('workflowRuns'),
  // Denormalized for per-workflow step analytics without a join.
  workflowId: v.id('workflows'),
  leadId: v.id('leads'),
  nodeId: v.string(),
  nodeType: v.string(),
  status: workflowStepOutcomeValidator,
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  // Branch nodes: which side the run took.
  branchResult: v.optional(v.boolean()),
  // Error text, webhook HTTP status, wake time, 'dev_whitelist_skip'…
  detail: v.optional(v.string()),
});

export type WorkflowEmailEvent = Infer<typeof workflowEmailEventValidator>;
export type WorkflowSmsEvent = Infer<typeof workflowSmsEventValidator>;
export type WorkflowTrigger = Infer<typeof workflowTriggerValidator>;
export type WorkflowTriggerType = WorkflowTrigger['type'];
export type WorkflowLeadTarget = Infer<typeof workflowLeadTargetValidator>;
export type WorkflowWaitUnit = Infer<typeof workflowWaitUnitValidator>;
export type WorkflowNode = Infer<typeof workflowNodeValidator>;
export type WorkflowNodeType = WorkflowNode['type'];
export type WorkflowStatus = Infer<typeof workflowStatusValidator>;
export type Workflow = Infer<typeof workflowValidator>;
export type WorkflowRunStatus = Infer<typeof workflowRunStatusValidator>;
export type WorkflowRun = Infer<typeof workflowRunValidator>;
export type WorkflowStepOutcome = Infer<typeof workflowStepOutcomeValidator>;
export type WorkflowRunStep = Infer<typeof workflowRunStepValidator>;
