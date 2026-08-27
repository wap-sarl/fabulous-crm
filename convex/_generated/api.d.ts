/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _lib_auth from "../_lib/auth.js";
import type * as _lib_functions from "../_lib/functions.js";
import type * as _lib_socialProviders from "../_lib/socialProviders.js";
import type * as _lib_softDelete from "../_lib/softDelete.js";
import type * as _lib_validators_activities from "../_lib/validators/activities.js";
import type * as _lib_validators_addressFormats from "../_lib/validators/addressFormats.js";
import type * as _lib_validators_appConfig from "../_lib/validators/appConfig.js";
import type * as _lib_validators_attachments from "../_lib/validators/attachments.js";
import type * as _lib_validators_auditLogs from "../_lib/validators/auditLogs.js";
import type * as _lib_validators_companies from "../_lib/validators/companies.js";
import type * as _lib_validators_companyRegistry from "../_lib/validators/companyRegistry.js";
import type * as _lib_validators_crm from "../_lib/validators/crm.js";
import type * as _lib_validators_deals from "../_lib/validators/deals.js";
import type * as _lib_validators_duplicates from "../_lib/validators/duplicates.js";
import type * as _lib_validators_employees from "../_lib/validators/employees.js";
import type * as _lib_validators_filters from "../_lib/validators/filters.js";
import type * as _lib_validators_invitations from "../_lib/validators/invitations.js";
import type * as _lib_validators_leadLists from "../_lib/validators/leadLists.js";
import type * as _lib_validators_lifecycle from "../_lib/validators/lifecycle.js";
import type * as _lib_validators_properties from "../_lib/validators/properties.js";
import type * as _lib_validators_shared from "../_lib/validators/shared.js";
import type * as _lib_validators_timeline from "../_lib/validators/timeline.js";
import type * as _lib_validators_users from "../_lib/validators/users.js";
import type * as _lib_validators_workflows from "../_lib/validators/workflows.js";
import type * as auth from "../auth.js";
import type * as auth_emailTemplates from "../auth/emailTemplates.js";
import type * as features_activities_mutations from "../features/activities/mutations.js";
import type * as features_activities_queries from "../features/activities/queries.js";
import type * as features_attachments_mutations from "../features/attachments/mutations.js";
import type * as features_attachments_queries from "../features/attachments/queries.js";
import type * as features_companies_actions from "../features/companies/actions.js";
import type * as features_companies_internal from "../features/companies/internal.js";
import type * as features_companies_mutations from "../features/companies/mutations.js";
import type * as features_companies_queries from "../features/companies/queries.js";
import type * as features_config_internal from "../features/config/internal.js";
import type * as features_config_mutations from "../features/config/mutations.js";
import type * as features_config_queries from "../features/config/queries.js";
import type * as features_crm_actions from "../features/crm/actions.js";
import type * as features_crm_internal from "../features/crm/internal.js";
import type * as features_crm_leadMatching from "../features/crm/leadMatching.js";
import type * as features_crm_leadTableFilters from "../features/crm/leadTableFilters.js";
import type * as features_crm_leadTargets from "../features/crm/leadTargets.js";
import type * as features_crm_mutations from "../features/crm/mutations.js";
import type * as features_crm_queries from "../features/crm/queries.js";
import type * as features_deals_mutations from "../features/deals/mutations.js";
import type * as features_deals_queries from "../features/deals/queries.js";
import type * as features_duplicates_internal from "../features/duplicates/internal.js";
import type * as features_duplicates_mutations from "../features/duplicates/mutations.js";
import type * as features_duplicates_queries from "../features/duplicates/queries.js";
import type * as features_email_actions from "../features/email/actions.js";
import type * as features_email_send from "../features/email/send.js";
import type * as features_invitations_internal from "../features/invitations/internal.js";
import type * as features_invitations_mutations from "../features/invitations/mutations.js";
import type * as features_invitations_queries from "../features/invitations/queries.js";
import type * as features_practitionerInfo_actions from "../features/practitionerInfo/actions.js";
import type * as features_properties_mutations from "../features/properties/mutations.js";
import type * as features_properties_queries from "../features/properties/queries.js";
import type * as features_timeline_queries from "../features/timeline/queries.js";
import type * as features_users_queries from "../features/users/queries.js";
import type * as features_workflows_actions from "../features/workflows/actions.js";
import type * as features_workflows_internal from "../features/workflows/internal.js";
import type * as features_workflows_lib from "../features/workflows/lib.js";
import type * as features_workflows_mutations from "../features/workflows/mutations.js";
import type * as features_workflows_queries from "../features/workflows/queries.js";
import type * as features_workflows_triggerDispatch from "../features/workflows/triggerDispatch.js";
import type * as http from "../http.js";
import type * as lib_activities from "../lib/activities.js";
import type * as lib_activityAggregates from "../lib/activityAggregates.js";
import type * as lib_addresses from "../lib/addresses.js";
import type * as lib_appUrl from "../lib/appUrl.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_companies from "../lib/companies.js";
import type * as lib_companyAggregates from "../lib/companyAggregates.js";
import type * as lib_companyDomains from "../lib/companyDomains.js";
import type * as lib_companySearch from "../lib/companySearch.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_dbHelpers from "../lib/dbHelpers.js";
import type * as lib_dealAggregates from "../lib/dealAggregates.js";
import type * as lib_deals from "../lib/deals.js";
import type * as lib_devWhitelist from "../lib/devWhitelist.js";
import type * as lib_duplicates from "../lib/duplicates.js";
import type * as lib_emailProvider from "../lib/emailProvider.js";
import type * as lib_emailUtils from "../lib/emailUtils.js";
import type * as lib_fileStorage from "../lib/fileStorage.js";
import type * as lib_filterMatching from "../lib/filterMatching.js";
import type * as lib_index from "../lib/index.js";
import type * as lib_leadAggregates from "../lib/leadAggregates.js";
import type * as lib_leadListMembers from "../lib/leadListMembers.js";
import type * as lib_leadSearch from "../lib/leadSearch.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_properties from "../lib/properties.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_smsUtils from "../lib/smsUtils.js";
import type * as lib_smtpUtils from "../lib/smtpUtils.js";
import type * as lib_timeConstants from "../lib/timeConstants.js";
import type * as lib_timeline from "../lib/timeline.js";
import type * as lib_userUtils from "../lib/userUtils.js";
import type * as seed_devEmployee from "../seed/devEmployee.js";
import type * as setup_helpers from "../setup/helpers.js";
import type * as setup_mutations from "../setup/mutations.js";
import type * as setup_queries from "../setup/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_lib/auth": typeof _lib_auth;
  "_lib/functions": typeof _lib_functions;
  "_lib/socialProviders": typeof _lib_socialProviders;
  "_lib/softDelete": typeof _lib_softDelete;
  "_lib/validators/activities": typeof _lib_validators_activities;
  "_lib/validators/addressFormats": typeof _lib_validators_addressFormats;
  "_lib/validators/appConfig": typeof _lib_validators_appConfig;
  "_lib/validators/attachments": typeof _lib_validators_attachments;
  "_lib/validators/auditLogs": typeof _lib_validators_auditLogs;
  "_lib/validators/companies": typeof _lib_validators_companies;
  "_lib/validators/companyRegistry": typeof _lib_validators_companyRegistry;
  "_lib/validators/crm": typeof _lib_validators_crm;
  "_lib/validators/deals": typeof _lib_validators_deals;
  "_lib/validators/duplicates": typeof _lib_validators_duplicates;
  "_lib/validators/employees": typeof _lib_validators_employees;
  "_lib/validators/filters": typeof _lib_validators_filters;
  "_lib/validators/invitations": typeof _lib_validators_invitations;
  "_lib/validators/leadLists": typeof _lib_validators_leadLists;
  "_lib/validators/lifecycle": typeof _lib_validators_lifecycle;
  "_lib/validators/properties": typeof _lib_validators_properties;
  "_lib/validators/shared": typeof _lib_validators_shared;
  "_lib/validators/timeline": typeof _lib_validators_timeline;
  "_lib/validators/users": typeof _lib_validators_users;
  "_lib/validators/workflows": typeof _lib_validators_workflows;
  auth: typeof auth;
  "auth/emailTemplates": typeof auth_emailTemplates;
  "features/activities/mutations": typeof features_activities_mutations;
  "features/activities/queries": typeof features_activities_queries;
  "features/attachments/mutations": typeof features_attachments_mutations;
  "features/attachments/queries": typeof features_attachments_queries;
  "features/companies/actions": typeof features_companies_actions;
  "features/companies/internal": typeof features_companies_internal;
  "features/companies/mutations": typeof features_companies_mutations;
  "features/companies/queries": typeof features_companies_queries;
  "features/config/internal": typeof features_config_internal;
  "features/config/mutations": typeof features_config_mutations;
  "features/config/queries": typeof features_config_queries;
  "features/crm/actions": typeof features_crm_actions;
  "features/crm/internal": typeof features_crm_internal;
  "features/crm/leadMatching": typeof features_crm_leadMatching;
  "features/crm/leadTableFilters": typeof features_crm_leadTableFilters;
  "features/crm/leadTargets": typeof features_crm_leadTargets;
  "features/crm/mutations": typeof features_crm_mutations;
  "features/crm/queries": typeof features_crm_queries;
  "features/deals/mutations": typeof features_deals_mutations;
  "features/deals/queries": typeof features_deals_queries;
  "features/duplicates/internal": typeof features_duplicates_internal;
  "features/duplicates/mutations": typeof features_duplicates_mutations;
  "features/duplicates/queries": typeof features_duplicates_queries;
  "features/email/actions": typeof features_email_actions;
  "features/email/send": typeof features_email_send;
  "features/invitations/internal": typeof features_invitations_internal;
  "features/invitations/mutations": typeof features_invitations_mutations;
  "features/invitations/queries": typeof features_invitations_queries;
  "features/practitionerInfo/actions": typeof features_practitionerInfo_actions;
  "features/properties/mutations": typeof features_properties_mutations;
  "features/properties/queries": typeof features_properties_queries;
  "features/timeline/queries": typeof features_timeline_queries;
  "features/users/queries": typeof features_users_queries;
  "features/workflows/actions": typeof features_workflows_actions;
  "features/workflows/internal": typeof features_workflows_internal;
  "features/workflows/lib": typeof features_workflows_lib;
  "features/workflows/mutations": typeof features_workflows_mutations;
  "features/workflows/queries": typeof features_workflows_queries;
  "features/workflows/triggerDispatch": typeof features_workflows_triggerDispatch;
  http: typeof http;
  "lib/activities": typeof lib_activities;
  "lib/activityAggregates": typeof lib_activityAggregates;
  "lib/addresses": typeof lib_addresses;
  "lib/appUrl": typeof lib_appUrl;
  "lib/audit": typeof lib_audit;
  "lib/companies": typeof lib_companies;
  "lib/companyAggregates": typeof lib_companyAggregates;
  "lib/companyDomains": typeof lib_companyDomains;
  "lib/companySearch": typeof lib_companySearch;
  "lib/crypto": typeof lib_crypto;
  "lib/dbHelpers": typeof lib_dbHelpers;
  "lib/dealAggregates": typeof lib_dealAggregates;
  "lib/deals": typeof lib_deals;
  "lib/devWhitelist": typeof lib_devWhitelist;
  "lib/duplicates": typeof lib_duplicates;
  "lib/emailProvider": typeof lib_emailProvider;
  "lib/emailUtils": typeof lib_emailUtils;
  "lib/fileStorage": typeof lib_fileStorage;
  "lib/filterMatching": typeof lib_filterMatching;
  "lib/index": typeof lib_index;
  "lib/leadAggregates": typeof lib_leadAggregates;
  "lib/leadListMembers": typeof lib_leadListMembers;
  "lib/leadSearch": typeof lib_leadSearch;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/properties": typeof lib_properties;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/smsUtils": typeof lib_smsUtils;
  "lib/smtpUtils": typeof lib_smtpUtils;
  "lib/timeConstants": typeof lib_timeConstants;
  "lib/timeline": typeof lib_timeline;
  "lib/userUtils": typeof lib_userUtils;
  "seed/devEmployee": typeof seed_devEmployee;
  "setup/helpers": typeof setup_helpers;
  "setup/mutations": typeof setup_mutations;
  "setup/queries": typeof setup_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  leadListMemberCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"leadListMemberCounts">;
  leadsByOwner: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"leadsByOwner">;
  leadsByLifecycle: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"leadsByLifecycle">;
  companiesTotal: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"companiesTotal">;
  leadsByCompany: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"leadsByCompany">;
  dealsByStage: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"dealsByStage">;
  dealsByPipelineStatus: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"dealsByPipelineStatus">;
  activitiesByOwner: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"activitiesByOwner">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
