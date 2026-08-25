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
import {
  leadPropertyTypeValidator,
  leadPropertyOptionValidator,
  leadPropertyValidationValidator,
  OPTION_BASED_TYPES,
  type LeadPropertyOption,
  type LeadPropertyType,
  type LeadPropertyValidation,
} from '../../_lib/validators/leadProperties';

/**
 * Validate the options array for an option-based property (select/radio/checkbox):
 * at least one option, each with a non-empty value, and no duplicate values
 * (values are stored on leads, so they must be unique + stable). Other types must
 * not carry options. Returns the cleaned options (trimmed) or undefined.
 */
function validateOptions(
  type: LeadPropertyType,
  options: LeadPropertyOption[] | undefined,
): LeadPropertyOption[] | undefined {
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
  type: LeadPropertyType,
  validation: LeadPropertyValidation | undefined,
): LeadPropertyValidation | undefined {
  if (!validation) return undefined;
  let cleaned: LeadPropertyValidation | undefined;
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
  args: {
    label: v.string(),
    type: leadPropertyTypeValidator,
    options: v.optional(v.array(leadPropertyOptionValidator)),
    validation: v.optional(leadPropertyValidationValidator),
    showInTable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const label = args.label.trim();
    if (!label) throw new Error('label_required');
    const options = validateOptions(args.type, args.options);
    const validation = validateValidation(args.type, args.validation);

    // Append after the current max order so new definitions land last.
    const existing = await ctx.db.query('leadPropertyDefinitions').collect();
    const maxOrder = existing
      .filter(isNotDeleted)
      .reduce((max, d) => Math.max(max, d.order ?? 0), 0);

    const definitionId = await ctx.db.insert('leadPropertyDefinitions', {
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
      entityType: 'leadPropertyDefinition',
      entityId: definitionId,
      action: 'create',
    });

    return definitionId;
  },
});

export const updateDefinition = adminMutation({
  // `type` is intentionally NOT accepted — it is immutable once values may exist.
  // To change a property's type, delete it and create a new one.
  args: {
    definitionId: v.id('leadPropertyDefinitions'),
    label: v.optional(v.string()),
    options: v.optional(v.array(leadPropertyOptionValidator)),
    validation: v.optional(leadPropertyValidationValidator),
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
        entityType: 'leadPropertyDefinition',
        entityId: definitionId,
        action: 'update',
        metadata: { changes },
      });
    }

    return definitionId;
  },
});

export const deleteDefinition = adminMutation({
  args: { definitionId: v.id('leadPropertyDefinitions') },
  handler: async (ctx, args) => {
    const def = await ctx.db.get(args.definitionId);
    if (!def || !isNotDeleted(def)) throw new Error('definition_not_found');

    // Soft delete: stored lead values remain untouched (and revive if the
    // definition is un-deleted). Every consumer iterates active definitions only.
    await ctx.db.patch(args.definitionId, {
      deletedAt: Date.now(),
      ...updateAuditFields(ctx.userId),
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadPropertyDefinition',
      entityId: args.definitionId,
      action: 'delete',
    });
  },
});

export const reorderDefinitions = adminMutation({
  args: { definitionIds: v.array(v.id('leadPropertyDefinitions')) },
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
      entityType: 'leadPropertyDefinition',
      entityId: 'reorder',
      action: 'update',
      metadata: { order: args.definitionIds },
    });
  },
});
