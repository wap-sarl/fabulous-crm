import { v } from 'convex/values';
// Trigger-wrapped constructor: API writes run the same triggers as UI writes (functions.ts).
import { internalMutation } from '../../_lib/functions';
import {
  activityCreateBody,
  activityPatchBody,
  companyCreateBody,
  companyPatchBody,
  contactCreateBody,
  contactPatchBody,
  dealCreateBody,
  dealPatchBody,
} from '../../lib/api/bodies';
import { toApiError } from '../../lib/api/errors';
import * as activities from '../../lib/api/writes/activities';
import * as companies from '../../lib/api/writes/companies';
import * as contacts from '../../lib/api/writes/contacts';
import * as deals from '../../lib/api/writes/deals';

/** The writes of the REST API, one function per route: what each does is in lib/api/writes, by resource. */

/** Backend error codes become API errors; the ConvexError rolls the write back. */
async function api<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (error) {
    throw toApiError(error);
  }
}

const byKey = { apiKeyId: v.id('apiKeys') };
const byKeyAndId = { ...byKey, id: v.string() };

export const createContact = internalMutation({
  args: { ...byKey, body: contactCreateBody },
  handler: (ctx, { apiKeyId, body }) => api(() => contacts.createContact(ctx, apiKeyId, body)),
});

export const upsertContact = internalMutation({
  args: { ...byKey, body: contactCreateBody },
  handler: (ctx, { apiKeyId, body }) => api(() => contacts.upsertContact(ctx, apiKeyId, body)),
});

export const updateContact = internalMutation({
  args: { ...byKeyAndId, body: contactPatchBody },
  handler: (ctx, { apiKeyId, id, body }) =>
    api(() => contacts.updateContact(ctx, apiKeyId, id, body)),
});

export const deleteContact = internalMutation({
  args: byKeyAndId,
  handler: (ctx, { apiKeyId, id }) => api(() => contacts.deleteContact(ctx, apiKeyId, id)),
});

export const createCompany = internalMutation({
  args: { ...byKey, body: companyCreateBody },
  handler: (ctx, { apiKeyId, body }) => api(() => companies.createCompany(ctx, apiKeyId, body)),
});

export const updateCompany = internalMutation({
  args: { ...byKeyAndId, body: companyPatchBody },
  handler: (ctx, { apiKeyId, id, body }) =>
    api(() => companies.updateCompany(ctx, apiKeyId, id, body)),
});

export const deleteCompany = internalMutation({
  args: byKeyAndId,
  handler: (ctx, { apiKeyId, id }) => api(() => companies.deleteCompany(ctx, apiKeyId, id)),
});

export const createDeal = internalMutation({
  args: { ...byKey, body: dealCreateBody },
  handler: (ctx, { apiKeyId, body }) => api(() => deals.createDeal(ctx, apiKeyId, body)),
});

export const updateDeal = internalMutation({
  args: { ...byKeyAndId, body: dealPatchBody },
  handler: (ctx, { apiKeyId, id, body }) => api(() => deals.updateDeal(ctx, apiKeyId, id, body)),
});

export const deleteDeal = internalMutation({
  args: byKeyAndId,
  handler: (ctx, { apiKeyId, id }) => api(() => deals.deleteDeal(ctx, apiKeyId, id)),
});

export const createActivity = internalMutation({
  args: { ...byKey, body: activityCreateBody },
  handler: (ctx, { apiKeyId, body }) => api(() => activities.createActivity(ctx, apiKeyId, body)),
});

export const updateActivity = internalMutation({
  args: { ...byKeyAndId, body: activityPatchBody },
  handler: (ctx, { apiKeyId, id, body }) =>
    api(() => activities.updateActivity(ctx, apiKeyId, id, body)),
});

export const deleteActivity = internalMutation({
  args: byKeyAndId,
  handler: (ctx, { apiKeyId, id }) => api(() => activities.deleteActivity(ctx, apiKeyId, id)),
});
