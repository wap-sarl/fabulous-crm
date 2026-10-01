import type { Doc, Id, TableNames } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import type { PropertyValue } from '../../../_lib/validators/properties';
import { computeChanges, logAudit } from '../../audit/log';
import { type PropertyDefinitionDoc, sanitizeCustomProperties } from '../../properties/definitions';
import { isNotDeleted } from '../../shared/db';
import { apiError } from '../errors';

/** The tables the API writes, with the name the audit log gives each. */
const ENTITY_TYPES = {
  leads: 'lead',
  companies: 'company',
  deals: 'deal',
  activities: 'activity',
} as const;
type WritableTable = keyof typeof ENTITY_TYPES;

/** A body id string as a typed id; a malformed one is an `invalid_fields` error. */
export function ref<T extends TableNames>(
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

export const refs = <T extends TableNames>(
  ctx: MutationCtx,
  table: T,
  values: string[],
  field: string,
) => values.map((value, i) => ref(ctx, table, value, `${field}[${i}]`));

/** The target of a write: the live document, else a 404. */
export async function target<T extends WritableTable>(
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
export function requireKnownProperties(
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
export function mergeCustomProperties(
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

/** Write what a PATCH asks and audit what it changed; `real` is the body's fields that count, `patch` what the document received. */
export async function applyPatch<T extends WritableTable>(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  table: T,
  doc: Doc<T>,
  updates: Record<string, unknown>,
) {
  const { updates: real, patch } = patchOf(doc, updates);
  const changes = computeChanges(doc, real);
  await ctx.db.patch(doc._id as Id<WritableTable>, { ...patch, updatedAt: Date.now() });
  if (changes) {
    await logAudit({
      ctx,
      apiKeyId,
      entityType: ENTITY_TYPES[table],
      entityId: doc._id,
      action: 'update',
      metadata: { changes },
    });
  }
  return { real, patch, changes };
}

/** A DELETE: the live document is marked deleted and the deletion audited; a second one is a 404. */
export async function softDelete<T extends WritableTable>(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  table: T,
  rawId: string,
): Promise<Doc<T>> {
  const doc = await target(ctx, table, rawId);
  await ctx.db.patch(doc._id as Id<WritableTable>, {
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  });
  await logAudit({
    ctx,
    apiKeyId,
    entityType: ENTITY_TYPES[table],
    entityId: doc._id,
    action: 'delete',
  });
  return doc;
}
