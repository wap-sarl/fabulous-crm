import { refusal, refusalFrom } from '../../_lib/refusal';
import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { settingsMutation } from '../../_lib/auth';
import {
  assignFieldKeys,
  formAfterSubmitValidator,
  formFieldInputValidator,
  validateFormShape,
  type FormFieldInput,
} from '../../_lib/validators/forms';
import { createAuditFields, logAudit, updateAuditFields } from '../../lib/audit/log';
import { isNotDeleted } from '../../lib/shared/db';
import { loadPropertyDefsById } from '../../lib/properties/definitions';

/** Every custom target must be a live, non-computed lead property. */
async function checkCustomTargets(ctx: MutationCtx, fields: FormFieldInput[]): Promise<void> {
  const defsById = await loadPropertyDefsById(ctx, 'lead');
  for (const field of fields) {
    if (field.target.kind !== 'custom') continue;
    const def = defsById.get(field.target.propertyDefId);
    if (!def || def.deletedAt !== undefined || def.computed) {
      throw refusal('form_unknown_property');
    }
  }
}

export const createForm = settingsMutation({
  args: {
    name: v.string(),
    fields: v.array(formFieldInputValidator),
    buttonText: v.string(),
    afterSubmit: formAfterSubmitValidator,
    consentText: v.string(),
    active: v.boolean(),
  },
  returns: v.id('forms'),
  handler: async (ctx, args) => {
    const error = validateFormShape(args);
    if (error) throw refusalFrom(error, 'invalid_form');
    await checkCustomTargets(ctx, args.fields);
    const formId = await ctx.db.insert('forms', {
      name: args.name.trim(),
      fields: assignFieldKeys(args.fields),
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
    fields: v.optional(v.array(formFieldInputValidator)),
    buttonText: v.optional(v.string()),
    afterSubmit: v.optional(formAfterSubmitValidator),
    consentText: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form || !isNotDeleted(form)) throw refusal('form_not_found');
    const next = {
      name: args.name ?? form.name,
      fields: args.fields ?? form.fields,
      buttonText: args.buttonText ?? form.buttonText,
      afterSubmit: args.afterSubmit ?? form.afterSubmit,
      consentText: args.consentText ?? form.consentText,
    };
    const error = validateFormShape(next);
    if (error) throw refusalFrom(error, 'invalid_form');
    if (args.fields) await checkCustomTargets(ctx, args.fields);
    await ctx.db.patch(args.formId, {
      name: next.name.trim(),
      // A field keeps its public key across edits, so stored submissions stay readable.
      fields: assignFieldKeys(next.fields, form.fields),
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
    return null;
  },
});

/** Soft delete: submissions and their timeline entries stay. */
export const deleteForm = settingsMutation({
  args: { formId: v.id('forms') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form || !isNotDeleted(form)) throw refusal('form_not_found');
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
    return null;
  },
});
