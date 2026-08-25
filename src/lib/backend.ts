/**
 * Frontend entry to the Convex backend, replacing the monorepo's
 * Backend re-exports: generated Convex API + CRM domain types.
 */
export { api, internal } from '../../convex/_generated/api';
export type { Id, Doc, TableNames, DataModel } from '../../convex/_generated/dataModel';
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
  CampaignEvent,
  CampaignEventType,
  TrackedLinkStandardField,
} from '../../convex/_lib/validators/crm';
// Pure, dependency-free — safe to bundle into the browser.
export { LEAD_STATUS_LABELS } from '../../convex/_lib/validators/crm';
export type {
  LifecycleStage,
  LifecycleConfig,
  LifecycleChangeSource,
} from '../../convex/_lib/validators/lifecycle';
export {
  DEFAULT_LIFECYCLE_CONFIG,
  LIFECYCLE_STAGE_KEY_RE,
  MAX_LIFECYCLE_STAGES,
  isLifecycleRegression,
  lifecycleStageIndex,
  lifecycleStageLabel,
} from '../../convex/_lib/validators/lifecycle';
export type {
  LeadPropertyType,
  LeadPropertyOption,
  LeadPropertyValue,
  LeadPropertyValidation,
  LeadPropertyDefinition,
} from '../../convex/_lib/validators/leadProperties';
// Pure, dependency-free helpers — safe to bundle into the browser.
export {
  validateLeadPropertyValue,
  customPropertyParamKey,
  formatLeadPropertyParamValue,
  OPTION_BASED_TYPES,
} from '../../convex/_lib/validators/leadProperties';
export type {
  StandardField,
  FilterField,
  FilterOperator,
  FilterRange,
  FilterRuleValue,
  FilterRule,
  FilterCombinator,
  FilterGroup,
  AdvancedFilter,
  FilterFieldType,
} from '../../convex/_lib/validators/leadFilters';
// Pure, dependency-free helpers — safe to bundle into the browser.
export { operatorsForType, isActiveRule } from '../../convex/_lib/validators/leadFilters';
export type {
  Workflow,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowTriggerType,
  WorkflowEmailEvent,
  WorkflowSmsEvent,
  WorkflowLeadTarget,
  WorkflowWaitUnit,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowStepOutcome,
} from '../../convex/_lib/validators/workflows';
