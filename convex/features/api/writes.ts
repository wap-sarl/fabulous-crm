import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id, TableNames } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
// Trigger-wrapped constructor: API writes run the same triggers as UI writes (functions.ts).
import { internalMutation } from '../../_lib/functions';
import { lifecycleStageIndex } from '../../_lib/validators/lifecycle';
import type { PropertyValue } from '../../_lib/validators/properties';
import { requireValidAddress } from '../../lib/addresses';
import { createActivityRecord, requireActivityLinks } from '../../lib/activities';
import {
  activityCreateBody,
  activityPatchBody,
  companyCreateBody,
  companyPatchBody,
  contactCreateBody,
  contactPatchBody,
  dealCreateBody,
  dealPatchBody,
  type ContactCreateBody,
} from '../../lib/apiBodies';
import {
  toPublicActivity,
  toPublicCompany,
  toPublicContact,
  toPublicDeal,
} from '../../lib/apiDtos';
import { apiError, toApiError } from '../../lib/apiErrors';
import {
  computeChanges,
  filterUndefined,
  generateHexToken,
  isNotDeleted,
  logAudit,
} from '../../lib';
import {
  blank,
  normalizeIdentifiers,
  requireCompany,
  resolveCompanyForLead,
} from '../../lib/companies';
import { createDealRecord, moveDealToStage, validateDealFields } from '../../lib/deals';
import {
  assertLifecycleTransition,
  insertLifecycleHistory,
  loadLifecycleConfig,
  planLifecycleTransition,
} from '../../lib/lifecycle';
import { cleanOwnerIds } from '../../lib/owners';
import {
  loadPropertyDefsById,
  type PropertyDefinitionDoc,
  sanitizeCustomProperties,
} from '../../lib/properties';
import { normalizeEmail } from '../crm/mutations';
import { diffLeadFilterFields } from '../workflows/lib';
import { dispatchWorkflowTrigger } from '../workflows/triggerDispatch';

const CONSENT_TOKEN_BYTES = 24;

/** Backend error codes become API errors; the ConvexError rolls the write back. */
async function api<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (error) {
    throw toApiError(error);
  }
}

/** A body id string as a typed id; a malformed one is an `invalid_fields` error. */
function ref<T extends TableNames>(
  ctx: MutationCtx,
  table: T,
  value: string,
  field: string,
): Id<T> {
  const id = ctx.db.normalizeId(table, value);
  if (!id) {
    throw apiError(400, 'invalid_fields', `${field} is not a valid id.`, { path: `.${field}` });
  }
  return id;
}

const refs = <T extends TableNames>(ctx: MutationCtx, table: T, values: string[], field: string) =>
  values.map((value, i) => ref(ctx, table, value, `${field}[${i}]`));

/** The target of a write: the live document, else a 404. */
async function target<T extends 'leads' | 'companies' | 'deals' | 'activities'>(
  ctx: MutationCtx,
  table: T,
  rawId: string,
): Promise<Doc<T>> {
  const id = ctx.db.normalizeId(table, rawId);
  const doc = (id ? await ctx.db.get(id) : null) as (Doc<T> & { deletedAt?: number }) | null;
  if (!doc || !isNotDeleted(doc)) throw apiError(404, 'not_found', 'No such record.');
  return doc;
}

/** Unknown or computed property ids are refused (the UI drops them silently). */
function requireKnownProperties(
  defs: Map<string, PropertyDefinitionDoc>,
  raw: Record<string, unknown> | undefined,
): void {
  for (const key of Object.keys(raw ?? {})) {
    const def = defs.get(key);
    if (!def) {
      throw apiError(400, 'unknown_property', `${key} is not a property definition id.`, {
        propertyId: key,
      });
    }
    if (def.computed) {
      throw apiError(400, 'read_only_field', `${def.label} is a computed property.`, {
        propertyId: key,
      });
    }
  }
}

/** PATCH semantics for custom properties: provided keys overwrite, `null` removes, the rest stay. */
function mergeCustomProperties(
  defs: Map<string, PropertyDefinitionDoc>,
  current: Record<string, PropertyValue> | undefined,
  patch: Record<string, PropertyValue | null>,
): Record<string, PropertyValue> {
  requireKnownProperties(defs, patch);
  const next = { ...(current ?? {}) };
  const set: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else set[key] = value;
  }
  return { ...next, ...(sanitizeCustomProperties(defs, set) ?? {}) };
}

/** PATCH → Convex patch: `null` clears (patched as undefined); clearing an absent field is a no-op. */
function patchOf(
  current: Record<string, unknown>,
  updates: Record<string, unknown>,
): { updates: Record<string, unknown>; patch: Record<string, unknown> } {
  const real: Record<string, unknown> = {};
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === null && current[key] === undefined) continue;
    real[key] = value;
    patch[key] = value === null ? undefined : value;
  }
  return { updates: real, patch };
}

// Contacts

/** No live lead may share an email with the one being written. */
async function assertEmailFree(
  ctx: MutationCtx,
  email: string | undefined,
  selfId?: Id<'leads'>,
): Promise<void> {
  if (!email) return;
  const rows = await ctx.db
    .query('leads')
    .withIndex('by_email', (q) => q.eq('email', email))
    .collect();
  const other = rows.find((l) => isNotDeleted(l) && l._id !== selfId);
  if (other) {
    throw apiError(409, 'duplicate_email', 'A contact with this email already exists.', {
      existingId: other._id,
    });
  }
}

/** Company of a contact write: explicit id, else hint (match or create), else email-domain match. */
async function contactCompany(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  body: Pick<ContactCreateBody, 'companyId' | 'company'>,
  email: string | undefined,
  current: Id<'companies'> | undefined,
): Promise<Id<'companies'> | undefined> {
  if (body.companyId !== undefined) {
    const companyId = ref(ctx, 'companies', body.companyId, 'companyId');
    await requireCompany(ctx, companyId);
    return companyId;
  }
  if (body.company || !current) {
    const found = await resolveCompanyForLead(ctx, body.company ?? {}, email, { apiKeyId });
    if (found) return found;
  }
  return current;
}

async function insertContact(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  body: ContactCreateBody,
  email: string | undefined,
): Promise<Id<'leads'>> {
  const defs = await loadPropertyDefsById(ctx, 'lead');
  requireKnownProperties(defs, body.customProperties);
  const customProperties = sanitizeCustomProperties(defs, body.customProperties);
  const lifecycle = await loadLifecycleConfig(ctx);
  const lifecycleStage = body.lifecycleStage ?? lifecycle.defaultStage;
  if (lifecycleStageIndex(lifecycle, lifecycleStage) === -1) {
    throw new Error('unknown_lifecycle_stage');
  }
  const ownerIds = await cleanOwnerIds(ctx, refs(ctx, 'users', body.ownerIds ?? [], 'ownerIds'));
  const companyId = await contactCompany(ctx, apiKeyId, body, email, undefined);

  const leadId = await ctx.db.insert('leads', {
    firstName: body.firstName?.trim() ?? '',
    lastName: body.lastName?.trim() ?? '',
    email,
    phone: body.phone?.trim() || undefined,
    address: requireValidAddress(body.address),
    // Consent starts empty; only the lead can grant it via the public link.
    marketingConsent: [],
    consentToken: generateHexToken(CONSENT_TOKEN_BYTES),
    comment: body.comment,
    ownerIds,
    companyId,
    isRedFlagged: body.isRedFlagged ?? false,
    lifecycleStage,
    customProperties,
    updatedAt: Date.now(),
  });
  await insertLifecycleHistory(
    ctx,
    leadId,
    { from: undefined, to: lifecycleStage },
    { source: 'api' },
  );
  await logAudit({ ctx, apiKeyId, entityType: 'lead', entityId: leadId, action: 'create' });
  await dispatchWorkflowTrigger(ctx, leadId, { type: 'lead_created' });
  return leadId;
}

/** Strict create: a live contact with the same email is a 409, never a merge. */
export const createContact = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), body: contactCreateBody },
  handler: (ctx, { apiKeyId, body }) =>
    api(async () => {
      const email = normalizeEmail(body.email);
      await assertEmailFree(ctx, email);
      const leadId = await insertContact(ctx, apiKeyId, body, email);
      return toPublicContact((await ctx.db.get(leadId))!);
    }),
});

/** Create-or-merge by email with the CSV-import rules; the oldest live match wins, else revive. */
export const upsertContact = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), body: contactCreateBody },
  handler: (ctx, { apiKeyId, body }) =>
    api(async () => {
      const email = normalizeEmail(body.email);
      if (!email) throw apiError(400, 'email_required', 'upsert matches on email.');
      const rows = await ctx.db
        .query('leads')
        .withIndex('by_email', (q) => q.eq('email', email))
        .collect();
      const existing = rows.find(isNotDeleted) ?? rows[0];
      if (!existing) {
        const leadId = await insertContact(ctx, apiKeyId, body, email);
        return { created: true, data: toPublicContact((await ctx.db.get(leadId))!) };
      }

      const defs = await loadPropertyDefsById(ctx, 'lead');
      requireKnownProperties(defs, body.customProperties);
      const custom = sanitizeCustomProperties(defs, body.customProperties);
      const updates: Record<string, unknown> = filterUndefined({
        firstName: body.firstName?.trim(),
        lastName: body.lastName?.trim(),
        phone: body.phone?.trim() || undefined,
        address: requireValidAddress(body.address),
        comment: body.comment,
        ownerIds: body.ownerIds
          ? await cleanOwnerIds(ctx, refs(ctx, 'users', body.ownerIds, 'ownerIds'))
          : undefined,
        isRedFlagged: body.isRedFlagged,
      });
      if (custom && Object.keys(custom).length > 0) {
        updates.customProperties = { ...existing.customProperties, ...custom };
      }
      const companyId = await contactCompany(ctx, apiKeyId, body, email, existing.companyId);
      if (companyId !== existing.companyId) updates.companyId = companyId;

      const changes = computeChanges(existing, updates);
      const revived = existing.deletedAt != null;
      await ctx.db.patch(existing._id, {
        ...updates,
        ...(revived ? { deletedAt: undefined } : {}),
        updatedAt: Date.now(),
      });
      if (changes || revived) {
        await logAudit({
          ctx,
          apiKeyId,
          entityType: 'lead',
          entityId: existing._id,
          action: 'update',
          metadata: { changes, ...(revived ? { revived: true } : {}) },
        });
      }
      const changedFields = diffLeadFilterFields(existing, updates);
      if (changedFields.length > 0) {
        await dispatchWorkflowTrigger(ctx, existing._id, {
          type: 'lead_property_changed',
          changedFields,
        });
      }
      return { created: false, data: toPublicContact((await ctx.db.get(existing._id))!) };
    }),
});

export const updateContact = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), id: v.string(), body: contactPatchBody },
  handler: (ctx, { apiKeyId, id, body }) =>
    api(async () => {
      const lead = await target(ctx, 'leads', id);
      const updates: Record<string, unknown> = {};
      if (body.firstName !== undefined) updates.firstName = body.firstName.trim();
      if (body.lastName !== undefined) updates.lastName = body.lastName.trim();
      if (body.email !== undefined) {
        const email = body.email === null ? undefined : normalizeEmail(body.email);
        if (email !== lead.email) await assertEmailFree(ctx, email, lead._id);
        updates.email = email ?? null;
      }
      if (body.phone !== undefined) updates.phone = body.phone?.trim() || null;
      if (body.address !== undefined)
        updates.address = requireValidAddress(body.address ?? undefined) ?? null;
      if (body.comment !== undefined) updates.comment = body.comment;
      if (body.isRedFlagged !== undefined) updates.isRedFlagged = body.isRedFlagged;
      if (body.ownerIds !== undefined) {
        updates.ownerIds = await cleanOwnerIds(ctx, refs(ctx, 'users', body.ownerIds, 'ownerIds'));
      }
      // The company only changes on an explicit pick; a new email never re-attaches by itself.
      if (body.companyId !== undefined) {
        updates.companyId =
          body.companyId === null
            ? null
            : await contactCompany(
                ctx,
                apiKeyId,
                { companyId: body.companyId },
                undefined,
                undefined,
              );
      }
      let lifecycleChange: { from: string | undefined; to: string } | undefined;
      if (body.lifecycleStage !== undefined) {
        const plan = planLifecycleTransition(
          await loadLifecycleConfig(ctx),
          lead,
          body.lifecycleStage,
        );
        assertLifecycleTransition(plan);
        if (plan.kind === 'change') {
          lifecycleChange = plan;
          updates.lifecycleStage = plan.to;
        }
      }
      if (body.customProperties !== undefined) {
        updates.customProperties = mergeCustomProperties(
          await loadPropertyDefsById(ctx, 'lead'),
          lead.customProperties,
          body.customProperties,
        );
      }

      const { updates: real, patch } = patchOf(lead, updates);
      const changes = computeChanges(lead, real);
      await ctx.db.patch(lead._id, { ...patch, updatedAt: Date.now() });
      if (lifecycleChange) {
        await insertLifecycleHistory(ctx, lead._id, lifecycleChange, { source: 'api' });
      }
      if (changes) {
        await logAudit({
          ctx,
          apiKeyId,
          entityType: 'lead',
          entityId: lead._id,
          action: 'update',
          metadata: { changes },
        });
        const changedFields = diffLeadFilterFields(lead, patch);
        if (changedFields.length > 0) {
          await dispatchWorkflowTrigger(ctx, lead._id, {
            type: 'lead_property_changed',
            changedFields,
          });
        }
      }
      return toPublicContact((await ctx.db.get(lead._id))!);
    }),
});

export const deleteContact = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), id: v.string() },
  handler: (ctx, { apiKeyId, id }) =>
    api(async () => {
      const lead = await target(ctx, 'leads', id);
      await ctx.db.patch(lead._id, { deletedAt: Date.now(), updatedAt: Date.now() });
      await logAudit({ ctx, apiKeyId, entityType: 'lead', entityId: lead._id, action: 'delete' });
      return null;
    }),
});

// Companies

export const createCompany = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), body: companyCreateBody },
  handler: (ctx, { apiKeyId, body }) =>
    api(async () => {
      const name = body.name.trim();
      if (!name) throw new Error('company_name_required');
      const ids = await normalizeIdentifiers(ctx, body);
      const defs = await loadPropertyDefsById(ctx, 'company');
      requireKnownProperties(defs, body.customProperties);
      const companyId = await ctx.db.insert('companies', {
        name,
        ...ids,
        website: blank(body.website),
        sector: blank(body.sector),
        headcount: body.headcount,
        address: requireValidAddress(body.address),
        ownerIds: await cleanOwnerIds(ctx, refs(ctx, 'users', body.ownerIds ?? [], 'ownerIds')),
        customProperties: sanitizeCustomProperties(defs, body.customProperties),
        updatedAt: Date.now(),
      });
      await logAudit({
        ctx,
        apiKeyId,
        entityType: 'company',
        entityId: companyId,
        action: 'create',
      });
      return toPublicCompany((await ctx.db.get(companyId))!);
    }),
});

export const updateCompany = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), id: v.string(), body: companyPatchBody },
  handler: (ctx, { apiKeyId, id, body }) =>
    api(async () => {
      const company = await target(ctx, 'companies', id);
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = body.name.trim();
        if (!name) throw new Error('company_name_required');
        updates.name = name;
      }
      // Identifiers normalize together (the country picks the scheme); `null` clears one.
      const given = (value: string | null | undefined, current: string | undefined) =>
        value === null ? undefined : (value ?? current);
      if (
        body.country !== undefined ||
        body.registrationNumber !== undefined ||
        body.vatNumber !== undefined ||
        body.domain !== undefined
      ) {
        const ids = await normalizeIdentifiers(
          ctx,
          {
            country: body.country ?? company.country,
            registrationNumber: given(body.registrationNumber, company.registrationNumber),
            vatNumber: given(body.vatNumber, company.vatNumber),
            domain: given(body.domain, company.domain),
          },
          company._id,
        );
        updates.country = ids.country;
        updates.registrationNumber = ids.registrationNumber ?? null;
        updates.vatNumber = ids.vatNumber ?? null;
        updates.domain = ids.domain ?? null;
      }
      if (body.website !== undefined) updates.website = blank(body.website ?? undefined) ?? null;
      if (body.sector !== undefined) updates.sector = blank(body.sector ?? undefined) ?? null;
      if (body.headcount !== undefined) updates.headcount = body.headcount;
      if (body.address !== undefined) {
        updates.address = requireValidAddress(body.address ?? undefined) ?? null;
      }
      if (body.ownerIds !== undefined) {
        updates.ownerIds = await cleanOwnerIds(ctx, refs(ctx, 'users', body.ownerIds, 'ownerIds'));
      }
      if (body.customProperties !== undefined) {
        updates.customProperties = mergeCustomProperties(
          await loadPropertyDefsById(ctx, 'company'),
          company.customProperties,
          body.customProperties,
        );
      }

      const { updates: real, patch } = patchOf(company, updates);
      const changes = computeChanges(company, real);
      const renamed = typeof real.name === 'string' && real.name !== company.name;
      await ctx.db.patch(company._id, { ...patch, updatedAt: Date.now() });
      if (changes) {
        await logAudit({
          ctx,
          apiKeyId,
          entityType: 'company',
          entityId: company._id,
          action: 'update',
          metadata: { changes },
        });
      }
      // The company name is denormalized into its leads' searchText (see updateCompany).
      if (renamed) {
        await ctx.scheduler.runAfter(
          0,
          internal.features.companies.internal.restampCompanyLeadsSearchText,
          { companyId: company._id },
        );
      }
      return toPublicCompany((await ctx.db.get(company._id))!);
    }),
});

export const deleteCompany = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), id: v.string() },
  handler: (ctx, { apiKeyId, id }) =>
    api(async () => {
      const company = await target(ctx, 'companies', id);
      await ctx.db.patch(company._id, { deletedAt: Date.now(), updatedAt: Date.now() });
      await logAudit({
        ctx,
        apiKeyId,
        entityType: 'company',
        entityId: company._id,
        action: 'delete',
      });
      await ctx.scheduler.runAfter(0, internal.features.companies.internal.detachCompanyLeads, {
        companyId: company._id,
      });
      return null;
    }),
});

// Deals

export const createDeal = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), body: dealCreateBody },
  handler: (ctx, { apiKeyId, body }) =>
    api(async () => {
      const fields = {
        ...body,
        pipelineId: body.pipelineId
          ? ref(ctx, 'pipelines', body.pipelineId, 'pipelineId')
          : undefined,
        leadId: body.leadId ? ref(ctx, 'leads', body.leadId, 'leadId') : undefined,
        sourceCampaignId: body.sourceCampaignId
          ? ref(ctx, 'campaigns', body.sourceCampaignId, 'sourceCampaignId')
          : undefined,
        ownerIds: body.ownerIds ? refs(ctx, 'users', body.ownerIds, 'ownerIds') : undefined,
      };
      await validateDealFields(ctx, fields);
      const defs = await loadPropertyDefsById(ctx, 'deal');
      requireKnownProperties(defs, body.customProperties);
      const dealId = await createDealRecord(
        ctx,
        { ...fields, customProperties: sanitizeCustomProperties(defs, body.customProperties) },
        { source: 'api', apiKeyId },
      );
      return toPublicDeal((await ctx.db.get(dealId))!);
    }),
});

/** Field edits, then the stage move — through the transition graph, like a Kanban drop. */
export const updateDeal = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), id: v.string(), body: dealPatchBody },
  handler: (ctx, { apiKeyId, id, body }) =>
    api(async () => {
      const deal = await target(ctx, 'deals', id);
      if (body.stageKey === undefined && (body.stageTags || body.stageComment !== undefined)) {
        throw apiError(400, 'invalid_fields', 'stageTags and stageComment need a stageKey.', {
          path: '.stageTags',
        });
      }
      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) updates.title = body.title.trim();
      if (body.amount !== undefined) updates.amount = body.amount;
      if (body.currency !== undefined) updates.currency = body.currency.toUpperCase();
      if (body.expectedCloseDate !== undefined) updates.expectedCloseDate = body.expectedCloseDate;
      if (body.ownerIds !== undefined) {
        updates.ownerIds = refs(ctx, 'users', body.ownerIds, 'ownerIds');
      }
      if (body.leadId !== undefined) {
        updates.leadId = body.leadId === null ? null : ref(ctx, 'leads', body.leadId, 'leadId');
      }
      if (body.sourceCampaignId !== undefined) {
        updates.sourceCampaignId =
          body.sourceCampaignId === null
            ? null
            : ref(ctx, 'campaigns', body.sourceCampaignId, 'sourceCampaignId');
      }
      await validateDealFields(
        ctx,
        Object.fromEntries(
          Object.entries(updates).filter(([, value]) => value !== null),
        ) as Parameters<typeof validateDealFields>[1],
      );
      if (body.customProperties !== undefined) {
        updates.customProperties = mergeCustomProperties(
          await loadPropertyDefsById(ctx, 'deal'),
          deal.customProperties,
          body.customProperties,
        );
      }

      const { updates: real, patch } = patchOf(deal, updates);
      const changes = computeChanges(deal, real);
      await ctx.db.patch(deal._id, { ...patch, updatedAt: Date.now() });
      if (changes) {
        await logAudit({
          ctx,
          apiKeyId,
          entityType: 'deal',
          entityId: deal._id,
          action: 'update',
          metadata: { changes },
        });
      }
      if (body.stageKey !== undefined) {
        const fresh = (await ctx.db.get(deal._id))!;
        const move = await moveDealToStage(
          ctx,
          fresh,
          body.stageKey,
          { source: 'api', apiKeyId },
          { tags: body.stageTags, comment: body.stageComment },
        );
        if (move.kind === 'unknown_stage') throw new Error('unknown_stage');
        if (move.kind === 'unknown_tag') throw new Error('unknown_stage_tag');
        if (move.kind === 'tag_required') throw new Error('stage_tag_required');
        if (move.kind === 'forbidden') throw new Error('deal_transition_forbidden');
      }
      return toPublicDeal((await ctx.db.get(deal._id))!);
    }),
});

export const deleteDeal = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), id: v.string() },
  handler: (ctx, { apiKeyId, id }) =>
    api(async () => {
      const deal = await target(ctx, 'deals', id);
      await ctx.db.patch(deal._id, { deletedAt: Date.now(), updatedAt: Date.now() });
      await logAudit({ ctx, apiKeyId, entityType: 'deal', entityId: deal._id, action: 'delete' });
      return null;
    }),
});

// Activities

async function activityOwner(
  ctx: MutationCtx,
  raw: string | undefined,
): Promise<Id<'users'> | undefined> {
  if (raw === undefined) return undefined;
  const ownerId = ref(ctx, 'users', raw, 'ownerId');
  const user = await ctx.db.get(ownerId);
  if (user?.type !== 'employee' || !isNotDeleted(user)) throw new Error('invalid_owner');
  return ownerId;
}

async function activityTeam(
  ctx: MutationCtx,
  raw: string | undefined,
): Promise<Id<'teams'> | undefined> {
  if (raw === undefined) return undefined;
  const teamId = ref(ctx, 'teams', raw, 'teamId');
  const team = await ctx.db.get(teamId);
  if (!team || !isNotDeleted(team)) throw new Error('team_not_found');
  return teamId;
}

export const createActivity = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), body: activityCreateBody },
  handler: (ctx, { apiKeyId, body }) =>
    api(async () => {
      const defs = await loadPropertyDefsById(ctx, 'activity');
      requireKnownProperties(defs, body.customProperties);
      const activityId = await createActivityRecord(
        ctx,
        {
          type: body.type,
          title: body.title,
          description: body.description,
          dueAt: body.dueAt,
          status: body.status,
          ownerId: await activityOwner(ctx, body.ownerId),
          teamId: await activityTeam(ctx, body.teamId),
          leadId: body.leadId ? ref(ctx, 'leads', body.leadId, 'leadId') : undefined,
          companyId: body.companyId
            ? ref(ctx, 'companies', body.companyId, 'companyId')
            : undefined,
          dealId: body.dealId ? ref(ctx, 'deals', body.dealId, 'dealId') : undefined,
          outcome: body.outcome,
          customProperties: sanitizeCustomProperties(defs, body.customProperties),
        },
        { apiKeyId },
      );
      return toPublicActivity((await ctx.db.get(activityId))!);
    }),
});

export const updateActivity = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), id: v.string(), body: activityPatchBody },
  handler: (ctx, { apiKeyId, id, body }) =>
    api(async () => {
      const activity = await target(ctx, 'activities', id);
      const updates: Record<string, unknown> = {};
      if (body.type !== undefined) updates.type = body.type;
      if (body.title !== undefined) {
        const title = body.title.trim();
        if (!title) throw new Error('activity_title_required');
        updates.title = title;
      }
      if (body.description !== undefined) updates.description = body.description?.trim() || null;
      if (body.dueAt !== undefined) updates.dueAt = body.dueAt;
      if (body.outcome !== undefined) updates.outcome = body.outcome?.trim() || null;
      if (body.ownerId !== undefined) {
        updates.ownerId = body.ownerId === null ? null : await activityOwner(ctx, body.ownerId);
      }
      if (body.teamId !== undefined) {
        updates.teamId = body.teamId === null ? null : await activityTeam(ctx, body.teamId);
      }
      const links = {
        leadId: body.leadId ? ref(ctx, 'leads', body.leadId, 'leadId') : undefined,
        companyId: body.companyId ? ref(ctx, 'companies', body.companyId, 'companyId') : undefined,
        dealId: body.dealId ? ref(ctx, 'deals', body.dealId, 'dealId') : undefined,
      };
      await requireActivityLinks(ctx, links);
      if (body.leadId !== undefined) updates.leadId = links.leadId ?? null;
      if (body.companyId !== undefined) updates.companyId = links.companyId ?? null;
      if (body.dealId !== undefined) updates.dealId = links.dealId ?? null;
      if (body.status !== undefined && body.status !== activity.status) {
        updates.status = body.status;
        // Completion stamps completedAt; reopening clears it (like completeActivity / reopenActivity).
        if (body.status === 'done') updates.completedAt = Date.now();
        else if (body.status === 'open') updates.completedAt = null;
      }
      if (body.customProperties !== undefined) {
        updates.customProperties = mergeCustomProperties(
          await loadPropertyDefsById(ctx, 'activity'),
          activity.customProperties,
          body.customProperties,
        );
      }

      const { updates: real, patch } = patchOf(activity, updates);
      const changes = computeChanges(activity, real);
      await ctx.db.patch(activity._id, { ...patch, updatedAt: Date.now() });
      if (changes) {
        await logAudit({
          ctx,
          apiKeyId,
          entityType: 'activity',
          entityId: activity._id,
          action: 'update',
          metadata: { changes },
        });
      }
      return toPublicActivity((await ctx.db.get(activity._id))!);
    }),
});

export const deleteActivity = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), id: v.string() },
  handler: (ctx, { apiKeyId, id }) =>
    api(async () => {
      const activity = await target(ctx, 'activities', id);
      await ctx.db.patch(activity._id, { deletedAt: Date.now(), updatedAt: Date.now() });
      await logAudit({
        ctx,
        apiKeyId,
        entityType: 'activity',
        entityId: activity._id,
        action: 'delete',
      });
      return null;
    }),
});
