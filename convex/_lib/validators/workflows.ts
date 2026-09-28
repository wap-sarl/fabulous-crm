import { type Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';
import { leadAdvancedFilterValidator, leadFilterValidators } from './filters';
import { trackedLinkStandardFieldValidator } from './crm';
import { propertyValueValidator } from './properties';

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

/** An optional field left unset means "any" (list, campaign, changed field); finer targeting belongs in the workflow's `enrollmentCriteria`. */
export const workflowTriggerValidator = v.union(
  v.object({ type: v.literal('lead_created') }),
  v.object({
    type: v.literal('lead_property_changed'),
    // Unset = any filterable field change enrolls.
    watchedFields: v.optional(v.array(leadFilterValidators.filterField)),
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
  v.object({
    type: v.literal('score_threshold_crossed'),
    threshold: v.number(),
    direction: v.union(v.literal('up'), v.literal('down')),
  }),
  v.object({ type: v.literal('form_submitted'), formId: v.optional(v.id('forms')) }),
  v.object({ type: v.literal('deal_created'), pipelineId: v.optional(v.id('pipelines')) }),
  v.object({
    type: v.literal('deal_stage_changed'),
    pipelineId: v.optional(v.id('pipelines')),
    stageKey: v.optional(v.string()),
  }),
  v.object({ type: v.literal('deal_won'), pipelineId: v.optional(v.id('pipelines')) }),
  v.object({ type: v.literal('deal_lost'), pipelineId: v.optional(v.id('pipelines')) }),
);

/** The target of an `update_property` node, with the exclusions of the campaign tracked links: no `marketingConsent`, `assignedTo` or `address`. */
export const workflowLeadTargetValidator = v.union(
  v.object({ kind: v.literal('standard'), field: trackedLinkStandardFieldValidator }),
  v.object({ kind: v.literal('custom'), propertyDefId: v.id('propertyDefinitions') }),
);

export const workflowWaitUnitValidator = v.union(
  v.literal('minutes'),
  v.literal('hours'),
  v.literal('days'),
);

const nodeBase = {
  // Client-generated, unique within the workflow; `next`/`nextTrue`/`nextFalse` point at these ids, and an unset one ends the run on that path.
  id: v.string(),
  // The engine ignores it and the frontend recomputes the layout: kept only to round-trip cleanly.
  position: v.optional(v.object({ x: v.number(), y: v.number() })),
};

/** The graph is a strict tree, checked cycle-free at activation: at most one parent slot references a node, starting from the workflow's `startNodeId`. */
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
    value: propertyValueValidator,
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('set_lifecycle_stage'),
    stage: v.optional(v.string()),
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('create_deal'),
    pipelineId: v.optional(v.id('pipelines')),
    stageKey: v.optional(v.string()),
    title: v.string(),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('update_deal_stage'),
    pipelineId: v.optional(v.id('pipelines')),
    stageKey: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    next: v.optional(v.string()),
  }),
  v.object({
    ...nodeBase,
    type: v.literal('create_task'),
    activityType: v.optional(
      v.union(v.literal('task'), v.literal('call'), v.literal('meeting'), v.literal('email')),
    ),
    title: v.string(),
    description: v.optional(v.string()),
    dueInDays: v.optional(v.number()),
    ownerId: v.optional(v.id('users')),
    teamId: v.optional(v.id('teams')),
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
    // Evaluated against the lead when the run reaches the node; a condition with no active rule evaluates true, as evalAdvancedFilter does.
    condition: leadAdvancedFilterValidator,
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
  // Only 'active' enrolls and executes; trigger, criteria and nodes are editable only while 'draft' or 'paused'.
  status: workflowStatusValidator,
  trigger: workflowTriggerValidator,
  // Extra AND/OR conditions a lead must match at trigger time to be enrolled.
  enrollmentCriteria: v.optional(leadAdvancedFilterValidator),
  // false: a lead is enrolled once only; either way, never while it has an active run in this workflow.
  allowReEnrollment: v.boolean(),
  nodes: v.array(workflowNodeValidator),
  // Optional so a draft can be saved empty; required and validated at activation.
  startNodeId: v.optional(v.string()),
  // Bumped on enroll and finish so the list view never scans the runs.
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
  // trigger.type at enrollment ('manual' for a manual one), so the history still explains the entry after the trigger is edited.
  triggerType: v.string(),
  manual: v.optional(v.boolean()),
  enrolledAt: v.number(),
  finishedAt: v.optional(v.number()),
  // The node to execute next, unset once the run is finished; while parked on a wait it is already the post-wait node.
  currentNodeId: v.optional(v.string()),
  // Executed-step counter guarding against runaway graphs (MAX_STEPS_PER_RUN).
  stepCount: v.number(),
  // Set while parked on a wait; the scheduled function is kept so cancelRun and deleteWorkflow can cancel the sleep.
  wakeAt: v.optional(v.number()),
  scheduledFnId: v.optional(v.id('_scheduled_functions')),
  // Failure reason when status === 'failed' (e.g. 'step_removed').
  error: v.optional(v.string()),
});

/** 'pending' lasts only while a send or a webhook is in flight; a skip or a 'failed' step (provider error, webhook non-2xx) lets the run continue, only a structural problem fails the run. */
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
