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
  Deal,
  DealStatus,
  Pipeline,
  PipelineStage,
  DealStageHistory,
} from '../../convex/_lib/validators/deals';
export {
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  PIPELINE_STAGE_KEY_RE,
  defaultPipelineStage,
  pipelineStage,
  validatePipelineStages,
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
