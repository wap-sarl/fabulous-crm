/**
 * Frontend entry to the Convex backend, replacing the monorepo's
 * Backend re-exports: generated Convex API + CRM domain types.
 */
export { api, internal } from '../../convex/_generated/api';
export type { Id, Doc, TableNames, DataModel } from '../../convex/_generated/dataModel';
export type {
  Lead,
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
export type {
  LifecycleStage,
  LifecycleConfig,
  LifecycleChangeSource,
} from '../../convex/_lib/validators/lifecycle';
export type { Company } from '../../convex/_lib/validators/companies';
export type {
  Activity,
  ActivityType,
  ActivityStatus,
} from '../../convex/_lib/validators/activities';
export type { ActivityRow } from '../../convex/features/activities/queries';
export type { TimelineKind } from '../../convex/_lib/validators/timeline';
export { TIMELINE_KINDS } from '../../convex/_lib/validators/timeline';
export type { TimelineEvent } from '../../convex/features/timeline/queries';
export type {
  DuplicateReason,
  LeadDuplicate,
  DuplicateScan,
} from '../../convex/_lib/validators/duplicates';
export type { DuplicateLeadSummary } from '../../convex/features/duplicates/queries';
export type { Attachment, AttachmentEntityType } from '../../convex/_lib/validators/attachments';
export {
  ATTACHMENT_MAX_BYTES_CEILING,
  DEFAULT_ATTACHMENT_MAX_BYTES,
} from '../../convex/_lib/validators/attachments';
export type { AttachmentRow } from '../../convex/features/attachments/queries';
export type { Team } from '../../convex/_lib/validators/teams';
export type { EmployeeRole } from '../../convex/_lib/validators/employees';
export type {
  AccessLevel,
  AccessModule,
  AccessWarning,
  RoleAccess,
} from '../../convex/_lib/validators/access';
export {
  ACCESS_LEVELS,
  ACCESS_MODULES,
  accessWarnings,
  isFullAccess,
  uniformAccess,
} from '../../convex/_lib/validators/access';
export type { Role } from '../../convex/_lib/validators/roles';
export {
  ADMIN_ROLE_KEY,
  BUILT_IN_ROLE_KEYS,
  DEFAULT_ROLES,
  MAX_ROLE_LABEL_LENGTH,
  roleKeyOf,
} from '../../convex/_lib/validators/roles';
export type {
  Deal,
  DealStatus,
  Pipeline,
  PipelineStage,
  PipelineStageTag,
  PipelineTransition,
  PipelineLayout,
  PipelineGraphIssue,
  DealStageHistory,
} from '../../convex/_lib/validators/deals';
export {
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  MAX_STAGE_TAGS,
  PIPELINE_STAGE_KEY_RE,
  allowedTargets,
  analyzePipelineGraph,
  defaultPipelineStage,
  defaultTransitions,
  effectiveTransitions,
  fullTransitions,
  isFullTransitions,
  isTransitionAllowed,
  normalizeTransitions,
  pipelineStage,
  pruneLayout,
  pruneTransitions,
  stageRequiresTag,
  stageTagLabels,
  validatePipelineStages,
  validatePipelineTransitions,
} from '../../convex/_lib/validators/deals';
export type { DealRow } from '../../convex/features/deals/queries';
export type { RegistrationScheme } from '../../convex/_lib/validators/companyRegistry';
export {
  DEFAULT_COUNTRY,
  EU_COUNTRIES,
  GENERIC_REGISTRATION_SCHEME,
  REGISTRATION_SCHEMES,
  hasVatChecksum,
  registrationSchemeFor,
  vatSchemeFor,
} from '../../convex/_lib/validators/companyRegistry';
export type { VatScheme } from '../../convex/_lib/validators/companyRegistry';
export type {
  AddressFieldSpec,
  AddressFormat,
  FormattableAddress,
} from '../../convex/_lib/validators/addressFormats';
export {
  addressFormatFor,
  formatAddressLines,
  formatAddressOneLine,
  regionLabel,
  validateAddress,
} from '../../convex/_lib/validators/addressFormats';
export {
  companyDomainOfEmail,
  isFreeMailDomain,
  normalizeDomain,
} from '../../convex/lib/companyDomains';
export type {
  RegistrationLookupResult,
  VatLookupResult,
} from '../../convex/features/companies/actions';
export {
  DEFAULT_LIFECYCLE_CONFIG,
  LIFECYCLE_STAGE_KEY_RE,
  MAX_LIFECYCLE_STAGES,
  isLifecycleRegression,
  lifecycleStageIndex,
  lifecycleStageLabel,
} from '../../convex/_lib/validators/lifecycle';
export type {
  PropertyEntityType,
  PropertyType,
  PropertyOption,
  PropertyValue,
  PropertyValidation,
  PropertyDefinition,
} from '../../convex/_lib/validators/properties';
// Pure, dependency-free helpers — safe to bundle into the browser.
export {
  PROPERTY_ENTITY_TYPES,
  validatePropertyValue,
  customPropertyParamKey,
  formatPropertyParamValue,
  OPTION_BASED_TYPES,
} from '../../convex/_lib/validators/properties';
export type {
  PropertyRuleKey,
  PropertyTypeDescriptor,
} from '../../convex/_lib/validators/propertyTypes';
export { PROPERTY_TYPE_KEYS, PROPERTY_TYPES } from '../../convex/_lib/validators/propertyTypes';
export type {
  LeadStandardField,
  CompanyStandardField,
  DealStandardField,
  FilterField,
  FilterOperator,
  FilterRange,
  FilterRuleValue,
  FilterRule,
  FilterCombinator,
  FilterGroup,
  AdvancedFilter,
  LeadAdvancedFilter,
  CompanyAdvancedFilter,
  DealAdvancedFilter,
  FilterFieldType,
} from '../../convex/_lib/validators/filters';
// Pure, dependency-free helpers — safe to bundle into the browser.
export { operatorsForType, isActiveRule } from '../../convex/_lib/validators/filters';
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
