import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import { settingsMutation } from '../../_lib/auth';
import {
  createAuditFields,
  updateAuditFields,
  computeChanges,
  logAudit,
} from '../../lib/audit/log';
import { filterUndefined, isNotDeleted } from '../../lib/shared/db';
import { loadPropertyDefinitions } from '../../lib/properties/definitions';
import {
  propertyEntityTypeValidator,
  propertyTypeValidator,
  propertyOptionValidator,
  propertyValidationValidator,
  type PropertyOption,
  type PropertyType,
  type PropertyValidation,
} from '../../_lib/validators/properties';
import { PROPERTY_TYPES } from '../../_lib/validators/propertyTypes';

function validateOptions(
  type: PropertyType,
  options: PropertyOption[] | undefined,
): PropertyOption[] | undefined {
  if (!PROPERTY_TYPES[type].optionBased) return undefined;
  const cleaned = (options ?? [])
    .map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
    .filter((o) => o.value.length > 0);
  if (cleaned.length === 0) throw refusal('options_required');
  const values = new Set(cleaned.map((o) => o.value));
  if (values.size !== cleaned.length) throw refusal('duplicate_option_values');
  return cleaned;
}

/** Keeps only the rules that apply to the type; undefined when none remain, which is what clears the stored field. */
function validateValidation(
  type: PropertyType,
  validation: PropertyValidation | undefined,
): PropertyValidation | undefined {
  if (!validation) return undefined;
  const rules: PropertyValidation = {};
  for (const key of PROPERTY_TYPES[type].rules) {
    const value = validation[key];
    if (value !== undefined && value !== '') (rules as Record<string, unknown>)[key] = value;
  }
  if (rules.min !== undefined && rules.max !== undefined && rules.min > rules.max)
    throw refusal('invalid_range');
  if ((rules.minLength ?? 0) < 0 || (rules.maxLength ?? 0) < 0) throw refusal('invalid_length');
  if (
    rules.minLength !== undefined &&
    rules.maxLength !== undefined &&
    rules.minLength > rules.maxLength
  )
    throw refusal('invalid_range');
  if (rules.pattern) {
    try {
      new RegExp(rules.pattern);
    } catch {
      throw refusal('invalid_pattern');
    }
  }
  const cleaned = filterUndefined(rules);
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export const createDefinition = settingsMutation({
  // `computed` is not accepted: computed definitions belong to the engine that maintains them.
  args: {
    entityType: propertyEntityTypeValidator,
    label: v.string(),
    type: propertyTypeValidator,
    options: v.optional(v.array(propertyOptionValidator)),
    validation: v.optional(propertyValidationValidator),
    showInTable: v.boolean(),
  },
  returns: v.id('propertyDefinitions'),
  handler: async (ctx, args) => {
    const label = args.label.trim();
    if (!label) throw refusal('label_required');
    const options = validateOptions(args.type, args.options);
    const validation = validateValidation(args.type, args.validation);

    // Append after the entity's current max order so new definitions land last.
    const existing = await loadPropertyDefinitions(ctx, args.entityType);
    const maxOrder = existing.reduce((max, d) => Math.max(max, d.order ?? 0), 0);

    const definitionId = await ctx.db.insert('propertyDefinitions', {
      entityType: args.entityType,
      label,
      type: args.type,
      options,
      validation,
      showInTable: args.showInTable,
      order: maxOrder + 1,
      ...createAuditFields(ctx.userId),
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'propertyDefinition',
      entityId: definitionId,
      action: 'create',
    });

    return definitionId;
  },
});

export const updateDefinition = settingsMutation({
  // `type` and `entityType` are NOT accepted: they are immutable once values may exist.
  args: {
    definitionId: v.id('propertyDefinitions'),
    label: v.optional(v.string()),
    options: v.optional(v.array(propertyOptionValidator)),
    validation: v.optional(propertyValidationValidator),
    showInTable: v.optional(v.boolean()),
    order: v.optional(v.number()),
  },
  returns: v.id('propertyDefinitions'),
  handler: async (ctx, args) => {
    const { definitionId, validation, ...rest } = args;
    const def = await ctx.db.get(definitionId);
    if (!def || !isNotDeleted(def)) throw refusal('definition_not_found');

    const updates: Record<string, unknown> = { ...rest };
    if (rest.label !== undefined) {
      const label = rest.label.trim();
      if (!label) throw refusal('label_required');
      updates.label = label;
    }
    if (rest.options !== undefined) {
      // Re-validate against the definition's (immutable) type.
      updates.options = validateOptions(def.type, rest.options);
    }

    // Applied outside filterUndefined, so that an emptied rule set (undefined) clears the stored field.
    const patchData: Record<string, unknown> = filterUndefined(updates);
    if (validation !== undefined) {
      patchData.validation = validateValidation(def.type, validation);
    }

    const changes = computeChanges(def, patchData);
    await ctx.db.patch(definitionId, { ...patchData, ...updateAuditFields(ctx.userId) });

    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'propertyDefinition',
        entityId: definitionId,
        action: 'update',
        metadata: { changes },
      });
    }

    return definitionId;
  },
});

export const deleteDefinition = settingsMutation({
  args: { definitionId: v.id('propertyDefinitions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const def = await ctx.db.get(args.definitionId);
    if (!def || !isNotDeleted(def)) throw refusal('definition_not_found');

    // Stored values stay untouched and revive if the definition is restored: every consumer iterates active definitions only.
    await ctx.db.patch(args.definitionId, {
      deletedAt: Date.now(),
      ...updateAuditFields(ctx.userId),
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'propertyDefinition',
      entityId: args.definitionId,
      action: 'delete',
    });
    return null;
  },
});

/** Reorder the definitions of one entity type (ids in their new display order). */
export const reorderDefinitions = settingsMutation({
  args: { definitionIds: v.array(v.id('propertyDefinitions')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    let position = 0;
    for (const definitionId of args.definitionIds) {
      const def = await ctx.db.get(definitionId);
      if (!def || !isNotDeleted(def)) continue;
      position++;
      if (def.order !== position) {
        await ctx.db.patch(definitionId, { order: position, ...updateAuditFields(ctx.userId) });
      }
    }
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'propertyDefinition',
      entityId: 'reorder',
      action: 'update',
      metadata: { order: args.definitionIds },
    });
    return null;
  },
});
