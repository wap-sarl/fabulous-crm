import { defineSchema, defineTable } from 'convex/server';
import { userValidator } from './_lib/validators/users';
import { auditLogValidator } from './_lib/validators/auditLogs';
import {
  leadValidator,
  campaignValidator,
  campaignSendValidator,
  campaignLinkTokenValidator,
  campaignEventValidator,
  leadNoteValidator,
} from './_lib/validators/crm';
import { leadPropertyDefinitionValidator } from './_lib/validators/leadProperties';
import { leadListValidator, leadListMemberValidator } from './_lib/validators/leadLists';
import { appConfigValidator } from './_lib/validators/appConfig';
import { invitationValidator } from './_lib/validators/invitations';
import { lifecycleStageHistoryValidator } from './_lib/validators/lifecycle';
import {
  workflowValidator,
  workflowRunValidator,
  workflowRunStepValidator,
} from './_lib/validators/workflows';

// Re-export everything for consumers
export type { Address } from './_lib/validators/shared';
export { addressValidator } from './_lib/validators/shared';

export type { User } from './_lib/validators/users';
export { userValidator } from './_lib/validators/users';

export type { AppConfig, SsoProvider } from './_lib/validators/appConfig';
export { appConfigValidator, ssoProviderValidator } from './_lib/validators/appConfig';

export type {
  LifecycleStage,
  LifecycleConfig,
  LifecycleChangeSource,
  LifecycleStageHistory,
} from './_lib/validators/lifecycle';
export {
  lifecycleStageValidator,
  lifecycleConfigValidator,
  lifecycleChangeSourceValidator,
  lifecycleStageHistoryValidator,
} from './_lib/validators/lifecycle';

export type { AuditLog, AuditLogEntityType, AuditLogAction } from './_lib/validators/auditLogs';

export type {
  Lead,
  LeadStatus,
  MarketingConsentChannel,
  ConsentSource,
  Campaign,
  CampaignStatus,
  CampaignChannel,
  MessageType,
  CampaignSend,
  CampaignSendStatus,
  CampaignTrackedLink,
  CampaignLinkToken,
  CampaignEvent,
  CampaignEventType,
  TrackedLinkStandardField,
  LeadNote,
} from './_lib/validators/crm';
export {
  leadValidator,
  leadStatusValidator,
  LEAD_STATUS_LABELS,
  trackedLinkStandardFieldValidator,
  marketingConsentChannelValidator,
  consentSourceValidator,
  campaignValidator,
  campaignStatusValidator,
  campaignChannelValidator,
  messageTypeValidator,
  campaignSendValidator,
  campaignSendStatusValidator,
  campaignTrackedLinkValidator,
  campaignLinkTokenValidator,
  campaignEventValidator,
  campaignEventTypeValidator,
  leadNoteValidator,
} from './_lib/validators/crm';

export type { LeadList, LeadListMember } from './_lib/validators/leadLists';
export { leadListValidator, leadListMemberValidator } from './_lib/validators/leadLists';

export type {
  WorkflowEmailEvent,
  WorkflowSmsEvent,
  WorkflowTrigger,
  WorkflowTriggerType,
  WorkflowLeadTarget,
  WorkflowWaitUnit,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowStatus,
  Workflow,
  WorkflowRunStatus,
  WorkflowRun,
  WorkflowStepOutcome,
  WorkflowRunStep,
} from './_lib/validators/workflows';
export {
  workflowEmailEventValidator,
  workflowSmsEventValidator,
  workflowTriggerValidator,
  workflowLeadTargetValidator,
  workflowWaitUnitValidator,
  workflowNodeValidator,
  workflowStatusValidator,
  workflowValidator,
  workflowRunStatusValidator,
  workflowRunValidator,
  workflowStepOutcomeValidator,
  workflowRunStepValidator,
} from './_lib/validators/workflows';

export type {
  LeadPropertyType,
  LeadPropertyOption,
  LeadPropertyValue,
  LeadPropertyValidation,
  LeadPropertyDefinition,
} from './_lib/validators/leadProperties';
export {
  leadPropertyTypeValidator,
  leadPropertyOptionValidator,
  leadPropertyValueValidator,
  leadPropertyValidationValidator,
  leadPropertyDefinitionValidator,
  validateLeadPropertyValue,
  customPropertyParamKey,
  formatLeadPropertyParamValue,
  OPTION_BASED_TYPES,
} from './_lib/validators/leadProperties';

export default defineSchema({
  // Sessions/accounts/verification live inside the Better Auth component
  // (convex/convex.config.ts), not in the app schema. See convex/auth.ts.
  users: defineTable(userValidator)
    .index('by_email', ['email', 'deletedAt'])
    .index('by_email_type', ['email', 'type', 'deletedAt'])
    .index('by_type', ['type'])
    .index('by_authId', ['authId']),

  // Invitation allowlist (Better Auth membership gate). See invitations validator.
  invitations: defineTable(invitationValidator)
    .index('by_email', ['email'])
    .index('by_email_status', ['email', 'status']),

  auditLogs: defineTable(auditLogValidator)
    .index('by_entity', ['entityType', 'entityId'])
    .index('by_user', ['userId'])
    .index('by_timestamp', ['timestamp']),

  leads: defineTable(leadValidator)
    // [status, _creationTime]: single-status filter under the default sort.
    .index('by_status', ['status'])
    // [assignedTo, status, _creationTime]: single-assignee filter (optionally
    // + single status) under the default sort. The assignedTo prefix subsumes
    // the former by_assignedTo index.
    .index('by_assignedTo_status', ['assignedTo', 'status'])
    // [lifecycleStage, _creationTime]: single-stage filter under the default sort.
    .index('by_lifecycleStage', ['lifecycleStage'])
    .index('by_consentToken', ['consentToken'])
    .index('by_lastName', ['lastName'])
    .index('by_email', ['email'])
    .searchIndex('by_searchText', { searchField: 'searchText' }),

  // Admin-defined custom property definitions for leads. Small, soft-deletable,
  // ordered table read in full (collect + isNotDeleted + sortByOrder) — no index.
  leadPropertyDefinitions: defineTable(leadPropertyDefinitionValidator),

  // Named lead groupings (typically CSV imports). Few rows, read in full.
  leadLists: defineTable(leadListValidator),

  // Lead ↔ list junction (a lead can be in many lists). `by_list_lead` serves
  // both membership-existence checks and by-list scans (prefix on listId).
  leadListMembers: defineTable(leadListMemberValidator)
    .index('by_list_lead', ['listId', 'leadId'])
    .index('by_lead', ['leadId']),

  campaigns: defineTable(campaignValidator).index('by_status', ['status']),

  campaignSends: defineTable(campaignSendValidator)
    .index('by_campaign', ['campaignId'])
    .index('by_campaign_status', ['campaignId', 'status'])
    .index('by_lead', ['leadId'])
    // Correlates Brevo SMS webhook events (STOP opt-outs) back to the lead.
    .index('by_brevoMessageId', ['brevoMessageId'])
    // Correlates inbound SMS events by recipient phone (Brevo `to`) — an inbound
    // STOP carries a fresh messageId that won't match by_brevoMessageId.
    .index('by_smsRecipient', ['smsRecipient']),

  // Per-recipient tracked-link tokens (see campaignLinkTokenValidator). Resolved
  // by the public GET /l/<token> HTTP route.
  campaignLinkTokens: defineTable(campaignLinkTokenValidator)
    .index('by_token', ['token'])
    .index('by_send', ['sendId']),

  // Append-only delivery/engagement event log (see campaignEventValidator).
  // `by_campaign_eventAt` drives the campaign page's desc-ordered paginated
  // table; `by_send` the per-recipient timeline (and webhook dedup).
  campaignEvents: defineTable(campaignEventValidator)
    .index('by_campaign_eventAt', ['campaignId', 'eventAt'])
    .index('by_send', ['sendId']),

  // Free-text notes attached to a lead (many per lead, pinnable). See crm validators.
  leadNotes: defineTable(leadNoteValidator).index('by_lead', ['leadId']),

  // Append-only lifecycle transitions (see lifecycleStageHistoryValidator).
  // `by_lead` serves the lead page timeline, in _creationTime order.
  lifecycleStageHistory: defineTable(lifecycleStageHistoryValidator).index('by_lead', ['leadId']),
  workflows: defineTable(workflowValidator),

  // One row per enrollment of a lead in a workflow. `by_workflow_lead` serves
  // the re-enrollment / active-run / daily-cap checks; `by_workflow_status`
  // resume-on-activate and active counts; `by_lead` the lead-page timeline.
  workflowRuns: defineTable(workflowRunValidator)
    .index('by_workflow', ['workflowId'])
    .index('by_workflow_status', ['workflowId', 'status'])
    .index('by_workflow_lead', ['workflowId', 'leadId'])
    .index('by_lead', ['leadId']),

  // Append-only per-run step log (≤ MAX_STEPS_PER_RUN rows per run).
  workflowRunSteps: defineTable(workflowRunStepValidator).index('by_run', ['runId']),

  // Singleton runtime config (org basics + SSO providers). Read with `.first()`.
  appConfig: defineTable(appConfigValidator),
});
