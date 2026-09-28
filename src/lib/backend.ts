/**
 * Frontend entry to the Convex backend, replacing the monorepo's
 * Backend re-exports: generated Convex API + CRM domain types.
 */
export { api } from '../../convex/_generated/api';
export type { Id, Doc } from '../../convex/_generated/dataModel';
export type {
  MarketingConsentChannel,
  CampaignStatus,
  CampaignChannel,
  MessageType,
  CampaignSendStatus,
  CampaignTrackedLink,
  CampaignEventType,
  TrackedLinkStandardField,
} from '../../convex/_lib/validators/crm';
export type {
  LifecycleStage,
  LifecycleConfig,
  LifecycleChangeSource,
} from '../../convex/_lib/validators/lifecycle';
export type {
  ActivityType,
  ActivityStatus,
} from '../../convex/_lib/validators/activities';
export type { ActivityRow } from '../../convex/features/activities/queries';
export type {
  Form,
  FormFieldInput,
  FormStandardField,
} from '../../convex/_lib/validators/forms';
export { FORM_STANDARD_FIELDS, formFieldKey } from '../../convex/_lib/validators/forms';
export type { TimelineKind } from '../../convex/_lib/validators/timeline';
export type { TimelineEvent } from '../../convex/features/timeline/queries';
export type { DuplicateReason } from '../../convex/_lib/validators/duplicates';
export type { DuplicateLeadSummary } from '../../convex/features/duplicates/queries';
export type { AttachmentEntityType } from '../../convex/_lib/validators/attachments';
export { RETENTION_BOUNDS, type RetentionKey } from '../../convex/_lib/validators/retention';
export {
  ATTACHMENT_MAX_BYTES_CEILING,
  ATTACHMENT_RETENTION_MAX_DAYS,
  ATTACHMENT_RETENTION_MIN_DAYS,
} from '../../convex/_lib/validators/attachments';
export type {
  AttachmentRow,
  TrashedAttachmentRow,
} from '../../convex/features/attachments/queries';
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
} from '../../convex/_lib/validators/access';
export {
  ADMIN_ROLE_KEY,
  DEFAULT_ROLES,
  MAX_ROLE_LABEL_LENGTH,
} from '../../convex/_lib/validators/roles';
export type {
  DealStatus,
  PipelineStage,
  PipelineStageTag,
  PipelineTransition,
  PipelineLayout,
  PipelineGraphIssue,
} from '../../convex/_lib/validators/deals';
export {
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  MAX_STAGE_TAGS,
  analyzePipelineGraph,
  defaultPipelineStage,
  effectiveTransitions,
  fullTransitions,
  isFullTransitions,
  isTransitionAllowed,
  pruneTransitions,
  stageRequiresTag,
  validatePipelineStages,
  validatePipelineTransitions,
} from '../../convex/_lib/validators/deals';
export type { DealRow } from '../../convex/features/deals/queries';
export {
  DEFAULT_COUNTRY,
  EU_COUNTRIES,
  registrationSchemeFor,
  vatSchemeFor,
} from '../../convex/_lib/validators/companyRegistry';
export type { FormattableAddress } from '../../convex/_lib/validators/addressFormats';
export {
  addressFormatFor,
  formatAddressOneLine,
  validateAddress,
} from '../../convex/_lib/validators/addressFormats';
export type { VatLookupResult } from '../../convex/features/companies/actions';
export {
  DEFAULT_LIFECYCLE_CONFIG,
  LIFECYCLE_STAGE_KEY_RE,
  MAX_LIFECYCLE_STAGES,
} from '../../convex/_lib/validators/lifecycle';
export type {
  PropertyEntityType,
  PropertyType,
  PropertyValue,
  PropertyValidation,
} from '../../convex/_lib/validators/properties';
// Pure, dependency-free helpers — safe to bundle into the browser.
export {
  validatePropertyValue,
  customPropertyParamKey,
} from '../../convex/_lib/validators/properties';
export { PROPERTY_TYPE_KEYS, PROPERTY_TYPES } from '../../convex/_lib/validators/propertyTypes';
export type {
  LeadStandardField,
  CompanyStandardField,
  DealStandardField,
  FilterField,
  FilterOperator,
  FilterRange,
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
  WorkflowLeadTarget,
  WorkflowWaitUnit,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRunStatus,
  WorkflowStepOutcome,
} from '../../convex/_lib/validators/workflows';
export type { ApiScope } from '../../convex/_lib/validators/apiKeys';
export {
  IMPORT_MAX_ROWS,
  IMPORT_UPLOAD_CHUNK,
} from '../../convex/_lib/validators/imports';
export type {
  ActivityImportRow,
  CompanyImportRow,
  DealImportRow,
  ImportEntity,
  ImportJobStatus,
  ImportRowOutcome,
  LeadImportRow,
} from '../../convex/_lib/validators/imports';
export {
  TRACK_TOTAL_PER_MINUTE,
  TRACKING_RETENTION_BOUNDS,
  trackingOriginsSchema,
  trackingPrivacyUrlSchema,
  VISITED_PAGES_MAX,
} from '../../convex/_lib/validators/tracking';
export type { TrackingMode } from '../../convex/_lib/validators/tracking';
