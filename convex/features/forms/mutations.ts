import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { settingsMutation } from '../../_lib/auth';
import {
  formAfterSubmitValidator,
  formFieldValidator,
  validateFormShape,
  type FormField,
} from '../../_lib/validators/forms';
import { createAuditFields, logAudit, updateAuditFields } from '../../lib/audit';
import { isNotDeleted } from '../../lib/dbHelpers';
import { loadPropertyDefsById } from '../../lib/properties';

/** Every custom target must be a live, non-computed lead property. */
async function checkCustomTargets(ctx: MutationCtx, fields: FormField[]): Promise<void> {
  const defsById = await loadPropertyDefsById(ctx, 'lead');
  for (const field of fields) {
    if (field.target.kind !== 'custom') continue;
    const def = defsById.get(field.target.propertyDefId);
    if (!def || def.deletedAt !== undefined || def.computed) {
      throw new Error('form_unknown_property');
    }
  }
}

export const createForm = settingsMutation({
  args: {
    name: v.string(),
    fields: v.array(formFieldValidator),
    buttonText: v.string(),
    afterSubmit: formAfterSubmitValidator,
    consentText: v.string(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const error = validateFormShape(args);
    if (error) throw new Error(error);
    await checkCustomTargets(ctx, args.fields);
    const formId = await ctx.db.insert('forms', {
      name: args.name.trim(),
      fields: args.fields,
      buttonText: args.buttonText.trim(),
      afterSubmit: args.afterSubmit,
      consentText: args.consentText.trim(),
      active: args.active,
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'form',
      entityId: formId,
      action: 'create',
    });
    return formId;
  },
});

export const updateForm = settingsMutation({
  args: {
    formId: v.id('forms'),
    name: v.optional(v.string()),
    fields: v.optional(v.array(formFieldValidator)),
    buttonText: v.optional(v.string()),
    afterSubmit: v.optional(formAfterSubmitValidator),
    consentText: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form || !isNotDeleted(form)) throw new Error('form_not_found');
    const next = {
      name: args.name ?? form.name,
      fields: args.fields ?? form.fields,
      buttonText: args.buttonText ?? form.buttonText,
      afterSubmit: args.afterSubmit ?? form.afterSubmit,
      consentText: args.consentText ?? form.consentText,
    };
    const error = validateFormShape(next);
    if (error) throw new Error(error);
    if (args.fields) await checkCustomTargets(ctx, args.fields);
    await ctx.db.patch(args.formId, {
      name: next.name.trim(),
      fields: next.fields,
      buttonText: next.buttonText.trim(),
      afterSubmit: next.afterSubmit,
      consentText: next.consentText.trim(),
      ...(args.active !== undefined && { active: args.active }),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'form',
      entityId: args.formId,
      action: 'update',
      metadata: {
        fields: Object.keys(args).filter(
          (k) => k !== 'formId' && (args as Record<string, unknown>)[k] !== undefined,
        ),
      },
    });
  },
});

/** Soft delete: submissions and their timeline entries stay. */
export const deleteForm = settingsMutation({
  args: { formId: v.id('forms') },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form || !isNotDeleted(form)) throw new Error('form_not_found');
    await ctx.db.patch(args.formId, {
      deletedAt: Date.now(),
      active: false,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'form',
      entityId: args.formId,
      action: 'delete',
    });
  },
});
