import { v } from 'convex/values';
import { adminMutation } from '../../_lib/auth';
import {
  createAuditFields,
  updateAuditFields,
  computeChanges,
  filterUndefined,
  logAudit,
  isNotDeleted,
} from '../../lib';
import { loadPropertyDefinitions } from '../../lib/properties';
import {
  propertyEntityTypeValidator,
  propertyTypeValidator,
  propertyOptionValidator,
  propertyValidationValidator,
  OPTION_BASED_TYPES,
  type PropertyOption,
  type PropertyType,
  type PropertyValidation,
} from '../../_lib/validators/properties';

function validateOptions(
  type: PropertyType,
  options: PropertyOption[] | undefined,
): PropertyOption[] | undefined {
  if (!OPTION_BASED_TYPES.includes(type)) return undefined;
  const cleaned = (options ?? [])
    .map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
    .filter((o) => o.value.length > 0);
  if (cleaned.length === 0) throw new Error('options_required');
  const values = new Set(cleaned.map((o) => o.value));
  if (values.size !== cleaned.length) throw new Error('duplicate_option_values');
  return cleaned;
}

/**
 * Keep only the validation rules that apply to a type (number → min/max, text →
 * length/pattern) and check they're coherent. Returns undefined when the type
 * carries no rules or none were provided.
 */
function validateValidation(
  type: PropertyType,
  validation: PropertyValidation | undefined,
): PropertyValidation | undefined {
  if (!validation) return undefined;
  let cleaned: PropertyValidation | undefined;
  if (type === 'number') {
    const { min, max } = validation;
    if (min !== undefined && max !== undefined && min > max) throw new Error('invalid_range');
    cleaned = filterUndefined({ min, max });
  } else if (type === 'text') {
    const { minLength, maxLength, pattern } = validation;
    if (minLength !== undefined && minLength < 0) throw new Error('invalid_length');
    if (maxLength !== undefined && maxLength < 0) throw new Error('invalid_length');
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength)
      throw new Error('invalid_range');
    if (pattern) {
      try {
        new RegExp(pattern);
      } catch {
        throw new Error('invalid_pattern');
      }
    }
    cleaned = filterUndefined({ minLength, maxLength, pattern: pattern || undefined });
  }
  return cleaned && Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export const createDefinition = adminMutation({
  // `computed` is not accepted: computed definitions belong to the engine that
  // maintains them (see propertyDefinitionValidator).
  args: {
    entityType: propertyEntityTypeValidator,
    label: v.string(),
    type: propertyTypeValidator,
    options: v.optional(v.array(propertyOptionValidator)),
    validation: v.optional(propertyValidationValidator),
    showInTable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const label = args.label.trim();
    if (!label) throw new Error('label_required');
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

export const updateDefinition = adminMutation({
  // `type` and `entityType` are intentionally NOT accepted — they are immutable
  // once values may exist. To change them, delete the property and create a new one.
  args: {
    definitionId: v.id('propertyDefinitions'),
    label: v.optional(v.string()),
    options: v.optional(v.array(propertyOptionValidator)),
    validation: v.optional(propertyValidationValidator),
    showInTable: v.optional(v.boolean()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { definitionId, validation, ...rest } = args;
    const def = await ctx.db.get(definitionId);
    if (!def || !isNotDeleted(def)) throw new Error('definition_not_found');

    const updates: Record<string, unknown> = { ...rest };
    if (rest.label !== undefined) {
      const label = rest.label.trim();
      if (!label) throw new Error('label_required');
      updates.label = label;
    }
    if (rest.options !== undefined) {
      // Re-validate against the definition's (immutable) type.
      updates.options = validateOptions(def.type, rest.options);
    }

    // Validation is applied outside filterUndefined so an emptied rule set
    // (validateValidation → undefined) actually clears the stored field.
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

export const deleteDefinition = adminMutation({
  args: { definitionId: v.id('propertyDefinitions') },
  handler: async (ctx, args) => {
    const def = await ctx.db.get(args.definitionId);
    if (!def || !isNotDeleted(def)) throw new Error('definition_not_found');

    // Soft delete: stored values remain untouched (and revive if the
    // definition is un-deleted). Every consumer iterates active definitions only.
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
  },
});

/** Reorder the definitions of one entity type (ids in their new display order). */
export const reorderDefinitions = adminMutation({
  args: { definitionIds: v.array(v.id('propertyDefinitions')) },
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
  },
});
