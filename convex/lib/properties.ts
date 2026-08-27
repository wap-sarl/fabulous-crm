import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  type PropertyEntityType,
  type PropertyValue,
  validatePropertyValue,
} from '../_lib/validators/properties';
import { PROPERTY_TYPES } from '../_lib/validators/propertyTypes';
import { isNotDeleted, sortByOrder } from './dbHelpers';

export type PropertyDefinitionDoc = Doc<'propertyDefinitions'>;

/** The active definitions of one entity type, in display order. */
export async function loadPropertyDefinitions(
  ctx: QueryCtx | MutationCtx,
  entityType: PropertyEntityType,
): Promise<PropertyDefinitionDoc[]> {
  const defs = await ctx.db
    .query('propertyDefinitions')
    .withIndex('by_entityType', (q) => q.eq('entityType', entityType))
    .collect();
  return defs.filter(isNotDeleted).sort(sortByOrder);
}

/** {@link loadPropertyDefinitions} keyed by id — the shape sanitizing and merge params consume. */
export async function loadPropertyDefsById(
  ctx: QueryCtx | MutationCtx,
  entityType: PropertyEntityType,
): Promise<Map<string, PropertyDefinitionDoc>> {
  const defs = await loadPropertyDefinitions(ctx, entityType);
  return new Map(defs.map((d) => [d._id as string, d]));
}

export function sanitizeCustomProperties(
  byId: Map<string, PropertyDefinitionDoc>,
  raw: Record<string, PropertyValue> | undefined,
): Record<string, PropertyValue> | undefined {
  if (!raw) return undefined;

  const clean: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    const def = byId.get(key);
    if (!def || def.computed) continue;
    const cleaned = PROPERTY_TYPES[def.type].sanitize(value, def);
    if (cleaned !== undefined) clean[key] = cleaned;

    if (clean[key] !== undefined) {
      const error = validatePropertyValue(def, clean[key]);
      if (error) throw new Error(`invalid_property_value: ${def.label}: ${error}`);
    }
  }
  return clean;
}
