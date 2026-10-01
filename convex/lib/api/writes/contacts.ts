import type { Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import { lifecycleStageIndex } from '../../../_lib/validators/lifecycle';
import { requireValidAddress } from '../../addresses/validation';
import { computeChanges, logAudit } from '../../audit/log';
import { requireCompany, resolveCompanyForLead } from '../../companies/lookup';
import { gateLeadCreate } from '../../extensions/gates';
import { CONSENT_TOKEN_BYTES } from '../../leads/import';
import {
  assertLifecycleTransition,
  insertLifecycleHistory,
  loadLifecycleConfig,
  planLifecycleTransition,
} from '../../leads/lifecycle';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../properties/definitions';
import { generateHexToken } from '../../security/crypto';
import { filterUndefined, isNotDeleted } from '../../shared/db';
import { cleanOwnerIds } from '../../users/owners';
import { dispatchWorkflowTrigger } from '../../workflows/dispatch';
import { diffLeadFilterFields } from '../../workflows/rules';
import { type ContactCreateBody, type ContactPatchBody, requireText } from '../bodies';
import { toPublicContact } from '../dtos';
import { apiError } from '../errors';
import {
  applyPatch,
  mergeCustomProperties,
  ref,
  refs,
  requireKnownProperties,
  softDelete,
  target,
} from './common';

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

/** The normalized email of a create body; blank is a 400 like the other identity fields. */
const requiredEmail = (raw: string) => requireText(raw, 'email').toLowerCase();

async function insertContact(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  body: ContactCreateBody,
  email: string,
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
  await gateLeadCreate(ctx, 1, 'api');

  const leadId = await ctx.db.insert('leads', {
    firstName: requireText(body.firstName, 'firstName'),
    lastName: requireText(body.lastName, 'lastName'),
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
  await logAudit({ ctx, apiKeyId, entityType: 'lead', entityId: leadId, action: 'create' });
  await insertLifecycleHistory(
    ctx,
    leadId,
    { from: undefined, to: lifecycleStage },
    { source: 'api' },
  );
  await dispatchWorkflowTrigger(ctx, leadId, { type: 'lead_created' });
  return leadId;
}

/** Strict create: a live contact with the same email is a 409, never a merge. */
export async function createContact(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  body: ContactCreateBody,
) {
  const email = requiredEmail(body.email);
  await assertEmailFree(ctx, email);
  const leadId = await insertContact(ctx, apiKeyId, body, email);
  return toPublicContact((await ctx.db.get(leadId))!);
}

/** Create-or-merge by email with the CSV-import rules; the oldest live match wins, else revive. */
export async function upsertContact(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  body: ContactCreateBody,
) {
  const email = requiredEmail(body.email);
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
    firstName: requireText(body.firstName, 'firstName'),
    lastName: requireText(body.lastName, 'lastName'),
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
  // A revived contact becomes live again: same gate as a creation.
  if (revived) await gateLeadCreate(ctx, 1, 'api');
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
}

export async function updateContact(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  id: string,
  body: ContactPatchBody,
) {
  const lead = await target(ctx, 'leads', id);
  const updates: Record<string, unknown> = {};
  if (body.firstName !== undefined) updates.firstName = requireText(body.firstName, 'firstName');
  if (body.lastName !== undefined) updates.lastName = requireText(body.lastName, 'lastName');
  if (body.email !== undefined) {
    const email = requiredEmail(body.email);
    if (email !== lead.email) await assertEmailFree(ctx, email, lead._id);
    updates.email = email;
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
        : await contactCompany(ctx, apiKeyId, { companyId: body.companyId }, undefined, undefined);
  }
  let lifecycleChange: { from: string | undefined; to: string } | undefined;
  if (body.lifecycleStage !== undefined) {
    const plan = planLifecycleTransition(await loadLifecycleConfig(ctx), lead, body.lifecycleStage);
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

  const { patch, changes } = await applyPatch(ctx, apiKeyId, 'leads', lead, updates);
  if (lifecycleChange) {
    await insertLifecycleHistory(ctx, lead._id, lifecycleChange, { source: 'api' });
  }
  if (changes) {
    const changedFields = diffLeadFilterFields(lead, patch);
    if (changedFields.length > 0) {
      await dispatchWorkflowTrigger(ctx, lead._id, {
        type: 'lead_property_changed',
        changedFields,
      });
    }
  }
  return toPublicContact((await ctx.db.get(lead._id))!);
}

export async function deleteContact(ctx: MutationCtx, apiKeyId: Id<'apiKeys'>, id: string) {
  await softDelete(ctx, apiKeyId, 'leads', id);
  return null;
}
