import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { LeadImportRow } from '../_lib/validators/imports';
import { type LifecycleConfig, lifecycleStageIndex } from '../_lib/validators/lifecycle';
import type { PropertyValue } from '../_lib/validators/properties';
import type { DuplicateReason } from '../_lib/validators/duplicates';
import {
  dispatchWorkflowTrigger,
  loadActiveWorkflows,
} from '../features/workflows/triggerDispatch';
import { diffLeadFilterFields } from '../features/workflows/lib';
import { computeChanges, createAuditFields, logAudit, updateAuditFields } from './audit';
import { filterUndefined, isNotDeleted } from './dbHelpers';
import { requireValidAddress } from './addresses';
import { resolveCompanyForLead } from './companies';
import { generateHexToken } from './crypto';
import {
  compareIdentities,
  findDuplicateCandidates,
  identityOf,
  nameBlock,
  nameKey,
  phoneKey,
  postalKey,
} from './duplicates';
import { insertListMember } from './leadListMembers';
import { insertLifecycleHistory, loadLifecycleConfig, planLifecycleTransition } from './lifecycle';
import { cleanOwnerIds } from './owners';
import {
  loadPropertyDefsById,
  type PropertyDefinitionDoc,
  sanitizeCustomProperties,
} from './properties';

/*
 * The contact upsert of the import, in two halves: `planLeadImport` decides what a row would do without writing
 * (the dry run's verdict) and `applyLeadImport` does it. The run calls both on the same row, so a dry run and the
 * run it precedes read the same rules by construction. The public API's upsert follows the same rules.
 */

export const CONSENT_TOKEN_BYTES = 24;

/** Emails are stored lowercased so the upsert can match on them. */
export function normalizeEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().toLowerCase();
  return email || undefined;
}

/** What is loaded once per batch rather than per row. */
export interface LeadImportCaches {
  propertyDefsById: Map<string, PropertyDefinitionDoc>;
  activeWorkflows: Doc<'workflows'>[];
  lifecycle: LifecycleConfig;
  // Company lookups and creations memoized across the batch: many rows share a domain.
  companyCache: Map<string, Id<'companies'>>;
}

export async function loadLeadImportCaches(ctx: MutationCtx): Promise<LeadImportCaches> {
  return {
    propertyDefsById: await loadPropertyDefsById(ctx, 'lead'),
    activeWorkflows: await loadActiveWorkflows(ctx),
    lifecycle: await loadLifecycleConfig(ctx),
    companyCache: new Map(),
  };
}

export type LeadImportPlan =
  | { kind: 'error'; error: string }
  | { kind: 'create'; customProperties: Record<string, PropertyValue> | undefined }
  | {
      kind: 'update';
      lead: Doc<'leads'>;
      customProperties: Record<string, PropertyValue> | undefined;
    }
  /** No email match, but a contact that looks like this row: the caller decides between update and create. */
  | { kind: 'duplicate'; lead: Doc<'leads'>; reasons: DuplicateReason[] };

/** The contact a row updates: the live one on that email, else a deleted one to revive, as the API does. */
export async function findLeadByEmail(
  ctx: MutationCtx,
  email: string,
): Promise<Doc<'leads'> | null> {
  const rows = await ctx.db
    .query('leads')
    .withIndex('by_email', (q) => q.eq('email', email))
    .collect();
  return rows.find(isNotDeleted) ?? rows[0] ?? null;
}

/** The best contact sharing a phone, a name and a postal code or a close name with the row, none when the email is shared. */
async function probableDuplicate(
  ctx: MutationCtx,
  row: LeadImportRow,
  email: string | undefined,
): Promise<{ lead: Doc<'leads'>; reasons: DuplicateReason[] } | null> {
  const identity = {
    phone: phoneKey(row.phone),
    name: nameKey(row.firstName, row.lastName),
    block: nameBlock(row.lastName),
    postal: postalKey(row.address?.postalCode),
    email,
  };
  let best: { lead: Doc<'leads'>; reasons: DuplicateReason[] } | null = null;
  let bestScore = 0;
  for (const candidate of await findDuplicateCandidates(ctx, identity)) {
    const { reasons, score } = compareIdentities(identity, identityOf(candidate));
    if (reasons.includes('email')) return null;
    if (score > bestScore) {
      bestScore = score;
      best = { lead: candidate, reasons };
    }
  }
  return best;
}

export function leadLabel(lead: Pick<Doc<'leads'>, 'firstName' | 'lastName' | 'email'>): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  return lead.email ? `${name} (${lead.email})` : name;
}

/**
 * What the row would do. `matchId` is a contact chosen beforehand (the duplicate a dry run found, with the policy
 * to update it); `detectDuplicates` asks for a probable duplicate when no email matches.
 */
export async function planLeadImport(
  ctx: MutationCtx,
  row: LeadImportRow,
  caches: LeadImportCaches,
  opts: { matchId?: Id<'leads'>; detectDuplicates: boolean },
): Promise<LeadImportPlan> {
  let customProperties: Record<string, PropertyValue> | undefined;
  try {
    requireValidAddress(row.address);
    customProperties = sanitizeCustomProperties(caches.propertyDefsById, row.customProperties);
    if (
      row.lifecycleStage !== undefined &&
      lifecycleStageIndex(caches.lifecycle, row.lifecycleStage) === -1
    ) {
      throw new Error('unknown_lifecycle_stage');
    }
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e.message : 'invalid_property_value' };
  }
  const email = normalizeEmail(row.email);
  const matched = opts.matchId ? await ctx.db.get(opts.matchId) : null;
  const existing = matched ?? (email ? await findLeadByEmail(ctx, email) : null);
  if (existing) return { kind: 'update', lead: existing, customProperties };
  if (opts.detectDuplicates) {
    const duplicate = await probableDuplicate(ctx, row, email);
    if (duplicate) return { kind: 'duplicate', ...duplicate };
  }
  return { kind: 'create', customProperties };
}

export interface LeadImportActor {
  userId: Id<'users'>;
  // The static list every created or updated contact joins.
  listId?: Id<'leadLists'>;
}

export type LeadImportResult =
  | { kind: 'created'; leadId: Id<'leads'> }
  | { kind: 'updated'; leadId: Id<'leads'> }
  | { kind: 'error'; error: string };

/**
 * Add a lead to a list if it isn't already a member. Idempotent across import
 * batches and re-imported emails (same lead appearing in several batches).
 */
export async function addLeadToList(
  ctx: MutationCtx,
  listId: Id<'leadLists'>,
  leadId: Id<'leads'>,
  userId: Id<'users'>,
  workflows?: Doc<'workflows'>[],
): Promise<void> {
  const existing = await ctx.db
    .query('leadListMembers')
    .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', leadId))
    .first();
  if (existing) return;
  await insertListMember(ctx, { listId, leadId, addedBy: userId });
  await dispatchWorkflowTrigger(
    ctx,
    leadId,
    { type: 'list_membership_changed', change: 'added', listId },
    { workflows },
  );
}

/** Writes what `planLeadImport` decided; a `duplicate` plan is applied as an update of that contact. */
export async function applyLeadImport(
  ctx: MutationCtx,
  row: LeadImportRow,
  plan: Exclude<LeadImportPlan, { kind: 'error' }>,
  caches: LeadImportCaches,
  actor: LeadImportActor,
): Promise<LeadImportResult> {
  const email = normalizeEmail(row.email);
  const { userId, listId } = actor;
  if (plan.kind === 'update' || plan.kind === 'duplicate') {
    const existing = plan.lead;
    const customProperties =
      plan.kind === 'update'
        ? plan.customProperties
        : sanitizeCustomProperties(caches.propertyDefsById, row.customProperties);
    // Upsert: only patch columns the file provided (filterUndefined drops the rest, keeping existing values).
    const updates: Record<string, unknown> = filterUndefined({
      firstName: row.firstName.trim(),
      lastName: row.lastName.trim(),
      // A duplicate matched on something else than the email may bring one.
      email: existing.email === undefined ? email : undefined,
      phone: row.phone?.trim() || undefined,
      address: row.address,
      comment: row.comment,
      ownerIds: row.ownerIds ? await cleanOwnerIds(ctx, row.ownerIds) : undefined,
      isRedFlagged: row.isRedFlagged,
    });
    // Merge custom properties: provided keys overwrite, the rest are kept.
    if (customProperties && Object.keys(customProperties).length) {
      updates.customProperties = { ...existing.customProperties, ...customProperties };
    }
    // Company: explicit data (re)attaches; otherwise a company-less contact gets the automatic email-domain match.
    try {
      if (row.company || !existing.companyId) {
        const matched = await resolveCompanyForLead(
          ctx,
          row.company ?? {},
          existing.email ?? email,
          { userId },
          caches.companyCache,
        );
        if (matched) updates.companyId = matched;
      }
    } catch (e) {
      return { kind: 'error', error: e instanceof Error ? e.message : 'company_error' };
    }

    let lifecycleChange: { from: string | undefined; to: string } | undefined;
    if (row.lifecycleStage !== undefined) {
      const transition = planLifecycleTransition(caches.lifecycle, existing, row.lifecycleStage);
      if (transition.kind === 'change') {
        lifecycleChange = transition;
        updates.lifecycleStage = transition.to;
      }
    }

    const changes = computeChanges(existing, updates);
    const patchData: Record<string, unknown> = { ...updates, ...updateAuditFields(userId) };
    // Revive a soft-deleted lead (patching undefined removes the field).
    const revived = existing.deletedAt != null;
    if (revived) patchData.deletedAt = undefined;
    await ctx.db.patch(existing._id, patchData);
    // A revival is a change even when no field differs, as in the API upsert.
    if (changes || revived) {
      await logAudit({
        ctx,
        userId,
        entityType: 'lead',
        entityId: existing._id,
        action: 'update',
        metadata: { changes, ...(revived ? { revived: true } : {}) },
      });
    }
    if (lifecycleChange) {
      await insertLifecycleHistory(ctx, existing._id, lifecycleChange, {
        source: 'import',
        changedBy: userId,
      });
    }
    if (changes) {
      const changedFields = diffLeadFilterFields(existing, updates);
      if (changedFields.length > 0) {
        await dispatchWorkflowTrigger(
          ctx,
          existing._id,
          { type: 'lead_property_changed', changedFields },
          { workflows: caches.activeWorkflows },
        );
      }
    }
    if (listId) await addLeadToList(ctx, listId, existing._id, userId, caches.activeWorkflows);
    return { kind: 'updated', leadId: existing._id };
  }

  let companyId: Id<'companies'> | undefined;
  try {
    companyId =
      (await resolveCompanyForLead(
        ctx,
        row.company ?? {},
        email,
        { userId },
        caches.companyCache,
      )) ?? undefined;
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e.message : 'invalid_row' };
  }
  const lifecycleStage = row.lifecycleStage ?? caches.lifecycle.defaultStage;
  const leadId = await ctx.db.insert('leads', {
    firstName: row.firstName.trim(),
    lastName: row.lastName.trim(),
    email,
    phone: row.phone?.trim() || undefined,
    address: row.address,
    // Consent starts empty; only the lead can grant it via the public link.
    marketingConsent: [],
    consentToken: generateHexToken(CONSENT_TOKEN_BYTES),
    comment: row.comment,
    ownerIds: row.ownerIds?.length ? await cleanOwnerIds(ctx, row.ownerIds) : [userId],
    companyId,
    isRedFlagged: row.isRedFlagged ?? false,
    lifecycleStage,
    customProperties: plan.customProperties,
    ...createAuditFields(userId),
  });
  await logAudit({
    ctx,
    userId,
    entityType: 'lead',
    entityId: leadId,
    action: 'create',
    metadata: { source: 'import' },
  });
  await insertLifecycleHistory(
    ctx,
    leadId,
    { from: undefined, to: lifecycleStage },
    { source: 'import', changedBy: userId },
  );
  await dispatchWorkflowTrigger(
    ctx,
    leadId,
    { type: 'lead_created' },
    { workflows: caches.activeWorkflows },
  );
  if (listId) await addLeadToList(ctx, listId, leadId, userId, caches.activeWorkflows);
  return { kind: 'created', leadId };
}
