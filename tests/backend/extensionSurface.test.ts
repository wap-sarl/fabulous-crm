import { describe, expect, test } from 'bun:test';
import { getFunctionName } from 'convex/server';
import { api, components, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from '../../convex/_generated/server';
import { employeeQuery, settingsMutation, settingsQuery } from '../../convex/_lib/auth';
import { ADMIN_ROLE_KEY } from '../../convex/_lib/validators/roles';
import { createAuth } from '../../convex/auth';
import {
  toPublicActivity,
  toPublicCompany,
  toPublicContact,
  toPublicDeal,
} from '../../convex/lib/apiDtos';
import { appOrigins } from '../../convex/lib/appUrl';
import { logAudit } from '../../convex/lib/audit';
import {
  decryptSecret,
  encryptSecret,
  generateHexToken,
  timingSafeEqual,
} from '../../convex/lib/crypto';
import {
  defaultExtensions,
  type Extensions,
  type RecordChange,
  SCHEDULED_WORK_RETRY_MS,
} from '../../convex/lib/extensionTypes';
import { leadsByLifecycle } from '../../convex/lib/leadAggregates';
import { loadLifecycleConfig } from '../../convex/lib/lifecycle';
import { checkRateLimit, clientIpOf, consumeRateLimit } from '../../convex/lib/rateLimits';
import { ensureDefaultRoles } from '../../convex/lib/roles';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

// What an overlay builds on besides the three files it replaces (docs/extensions.md): a name that moves breaks it, so it breaks here first.

/** The types an overlay names. */
export type BackendTypes = [
  Doc<'leads'>,
  Id<'leads'>,
  MutationCtx,
  QueryCtx,
  Extensions,
  RecordChange,
  T,
];

const VALUES = {
  components,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  employeeQuery,
  settingsMutation,
  settingsQuery,
  ADMIN_ROLE_KEY,
  createAuth,
  toPublicActivity,
  toPublicCompany,
  toPublicContact,
  toPublicDeal,
  appOrigins,
  logAudit,
  decryptSecret,
  encryptSecret,
  generateHexToken,
  timingSafeEqual,
  defaultExtensions,
  SCHEDULED_WORK_RETRY_MS,
  leadsByLifecycle,
  loadLifecycleConfig,
  checkRateLimit,
  clientIpOf,
  consumeRateLimit,
  ensureDefaultRoles,
  asIdentity,
  createTestConvex,
  seedEmployee,
  seedLead,
};

/** The functions an overlay calls, by the path it calls them with. */
const FUNCTIONS = {
  'auth:onCreate': internal.auth.onCreate,
  'features/activities/mutations:createActivity': api.features.activities.mutations.createActivity,
  'features/activities/mutations:deleteActivity': api.features.activities.mutations.deleteActivity,
  'features/api/mutations:createApiKey': api.features.api.mutations.createApiKey,
  'features/companies/mutations:createCompany': api.features.companies.mutations.createCompany,
  'features/companies/mutations:deleteCompany': api.features.companies.mutations.deleteCompany,
  'features/config/queries:getLifecycleConfig': api.features.config.queries.getLifecycleConfig,
  'features/config/queries:getPublicConfig': api.features.config.queries.getPublicConfig,
  'features/crm/actions:registerBrevoEmailWebhook':
    internal.features.crm.actions.registerBrevoEmailWebhook,
  'features/crm/actions:registerBrevoSmsWebhook':
    internal.features.crm.actions.registerBrevoSmsWebhook,
  'features/crm/actions:sendCampaignBatch': internal.features.crm.actions.sendCampaignBatch,
  'features/crm/internal:prepareCampaignBatch': internal.features.crm.internal.prepareCampaignBatch,
  'features/crm/mutations:createCampaign': api.features.crm.mutations.createCampaign,
  'features/crm/mutations:createLead': api.features.crm.mutations.createLead,
  'features/crm/mutations:deleteLead': api.features.crm.mutations.deleteLead,
  'features/crm/mutations:importLeads': api.features.crm.mutations.importLeads,
  'features/crm/mutations:resendAllCampaignSends':
    api.features.crm.mutations.resendAllCampaignSends,
  'features/crm/mutations:retryCampaignSend': api.features.crm.mutations.retryCampaignSend,
  'features/crm/mutations:updateConsentByToken': api.features.crm.mutations.updateConsentByToken,
  'features/crm/mutations:updateLead': api.features.crm.mutations.updateLead,
  'features/deals/mutations:createDeal': api.features.deals.mutations.createDeal,
  'features/deals/mutations:deleteDeal': api.features.deals.mutations.deleteDeal,
  'features/deals/mutations:ensureDefaultPipeline':
    api.features.deals.mutations.ensureDefaultPipeline,
  'features/deals/mutations:moveDealStage': api.features.deals.mutations.moveDealStage,
  'features/invitations/mutations:createInvitation':
    api.features.invitations.mutations.createInvitation,
  'features/workflows/internal:executeStep': internal.features.workflows.internal.executeStep,
  'features/workflows/mutations:createWorkflow': api.features.workflows.mutations.createWorkflow,
  'features/workflows/mutations:setWorkflowStatus':
    api.features.workflows.mutations.setWorkflowStatus,
};

describe('what an overlay builds on, backend', () => {
  test('every value it imports is there', () => {
    const missing = Object.entries(VALUES)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  test('every function it calls is where it calls it', async () => {
    for (const [path, reference] of Object.entries(FUNCTIONS)) {
      expect(getFunctionName(reference)).toBe(path);
      const [module, name] = path.split(':');
      const exported = (await import(`../../convex/${module}`)) as Record<string, unknown>;
      expect(exported[name], path).toBeDefined();
    }
  });
});
