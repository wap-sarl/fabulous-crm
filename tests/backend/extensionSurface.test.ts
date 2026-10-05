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
import { refusal } from '../../convex/_lib/refusal';
import { ADMIN_ROLE_KEY } from '../../convex/_lib/validators/roles';
import { createAuth } from '../../convex/auth';
import {
  toPublicActivity,
  toPublicCompany,
  toPublicContact,
  toPublicDeal,
} from '../../convex/lib/api/dtos';
import { appOrigins } from '../../convex/lib/config/appUrl';
import { logAudit } from '../../convex/lib/audit/log';
import {
  decryptSecret,
  encryptSecret,
  generateHexToken,
  timingSafeEqual,
} from '../../convex/lib/security/crypto';
import {
  defaultExtensions,
  type Extensions,
  type RecordChange,
  SCHEDULED_WORK_RETRY_MS,
} from '../../convex/lib/extensions/types';
import { leadsByLifecycle } from '../../convex/lib/leads/aggregates';
import { loadLifecycleConfig } from '../../convex/lib/leads/lifecycle';
import { checkRateLimit, clientIpOf, consumeRateLimit } from '../../convex/lib/security/rateLimits';
import { ensureDefaultRoles } from '../../convex/lib/roles/access';
import { asIdentity, createTestConvex, runDue, seedEmployee, seedLead, type T } from './helpers';

// What an overlay builds on besides the files it replaces (docs/extensions.md): a name that moves breaks it, so it breaks here first.

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
  refusal,
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
  runDue,
  seedEmployee,
  seedLead,
};

/** The functions an overlay calls; the reference is the path it calls them at. */
const FUNCTIONS = [
  internal.auth.onCreate,
  api.features.activities.mutations.createActivity,
  api.features.activities.mutations.deleteActivity,
  api.features.api.mutations.createApiKey,
  api.features.companies.mutations.createCompany,
  api.features.companies.mutations.deleteCompany,
  api.features.config.queries.getLifecycleConfig,
  api.features.config.queries.getPublicConfig,
  internal.features.campaigns.actions.registerBrevoEmailWebhook,
  internal.features.campaigns.actions.registerBrevoSmsWebhook,
  internal.features.campaigns.actions.sendCampaignBatch,
  internal.features.campaigns.internal.prepareCampaignBatch,
  api.features.campaigns.mutations.createCampaign,
  api.features.leads.mutations.createLead,
  api.features.leads.mutations.deleteLead,
  api.features.leads.mutations.importLeads,
  api.features.campaigns.mutations.resendAllCampaignSends,
  api.features.campaigns.mutations.retryCampaignSend,
  api.features.consent.mutations.updateConsentByToken,
  api.features.leads.mutations.updateLead,
  api.features.deals.mutations.createDeal,
  api.features.deals.mutations.deleteDeal,
  api.features.deals.mutations.ensureDefaultPipeline,
  api.features.deals.mutations.moveDealStage,
  api.features.invitations.mutations.createInvitation,
  internal.features.workflows.internal.executeStep,
  api.features.workflows.mutations.createWorkflow,
  api.features.workflows.mutations.setWorkflowStatus,
];

describe('what an overlay builds on, backend', () => {
  test('every value it imports is there', () => {
    const missing = Object.entries(VALUES)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  test('every function it calls is where it calls it', async () => {
    for (const reference of FUNCTIONS) {
      const path = getFunctionName(reference);
      const [module, name] = path.split(':');
      const exported = (await import(`../../convex/${module}`)) as Record<string, unknown>;
      expect(exported[name], path).toBeDefined();
    }
  });
});
