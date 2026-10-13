import { v } from 'convex/values';
import { employeeMutation, settingsMutation } from '../../_lib/auth';
import { refusal } from '../../_lib/refusal';
import { follows } from '../../_lib/validators/fields';
import {
  templateBodySchema,
  templateCategorySchema,
  templateNameSchema,
  templateScopeValidator,
  templateSubjectSchema,
} from '../../_lib/validators/emailTemplates';
import type { Doc } from '../../_generated/dataModel';
import { createAuditFields, logAudit, updateAuditFields } from '../../lib/audit/log';
import { ensureDefaultEmailTemplates, loadEmailTemplate } from '../../lib/templates/records';

type Fields = Pick<Doc<'emailTemplates'>, 'name' | 'subject' | 'htmlBody' | 'category'>;

/** Each field within its bounds, trimmed; an empty category is none. */
function checkFields(fields: Fields): Fields {
  if (!follows(templateNameSchema, fields.name)) throw refusal('template_name_invalid');
  if (!follows(templateSubjectSchema, fields.subject)) throw refusal('template_subject_invalid');
  if (!follows(templateBodySchema, fields.htmlBody)) throw refusal('template_body_invalid');
  if (!follows(templateCategorySchema.optional(), fields.category)) {
    throw refusal('template_category_invalid');
  }
  return {
    name: fields.name.trim(),
    subject: fields.subject.trim(),
    htmlBody: fields.htmlBody,
    category: fields.category?.trim() || undefined,
  };
}

const templateArgs = {
  name: v.string(),
  subject: v.string(),
  htmlBody: v.string(),
  category: v.optional(v.string()),
  scope: templateScopeValidator,
};

export const createEmailTemplate = employeeMutation({
  args: templateArgs,
  returns: v.id('emailTemplates'),
  handler: async (ctx, args) => {
    const fields = checkFields(args);
    const templateId = await ctx.db.insert('emailTemplates', {
      ...fields,
      scope: args.scope,
      ownerId: ctx.userId,
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'emailTemplate',
      entityId: templateId,
      action: 'create',
      metadata: { name: fields.name, scope: args.scope },
    });
    return templateId;
  },
});

/** The owner changes their template; the settings right changes any in reach. */
async function loadEditable(
  ctx: Parameters<typeof loadEmailTemplate>[0] & {
    userId: Doc<'users'>['_id'];
    visibility: { access: { settings: boolean } };
  },
  templateId: Doc<'emailTemplates'>['_id'],
) {
  const template = await loadEmailTemplate(ctx, templateId);
  if (template.ownerId !== ctx.userId && !ctx.visibility.access.settings) {
    throw refusal('template_forbidden');
  }
  return template;
}

export const updateEmailTemplate = employeeMutation({
  args: { templateId: v.id('emailTemplates'), ...templateArgs },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadEditable(ctx, args.templateId);
    const fields = checkFields(args);
    await ctx.db.patch(args.templateId, {
      ...fields,
      scope: args.scope,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'emailTemplate',
      entityId: args.templateId,
      action: 'update',
      metadata: { name: fields.name, scope: args.scope },
    });
    return null;
  },
});

/** The copy is the caller's own, private until they share it. */
export const duplicateEmailTemplate = employeeMutation({
  args: { templateId: v.id('emailTemplates') },
  returns: v.id('emailTemplates'),
  handler: async (ctx, args) => {
    const source = await loadEmailTemplate(ctx, args.templateId);
    const name = `${source.name} (copie)`.slice(0, 80);
    const templateId = await ctx.db.insert('emailTemplates', {
      name,
      subject: source.subject,
      htmlBody: source.htmlBody,
      category: source.category,
      scope: 'private',
      ownerId: ctx.userId,
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'emailTemplate',
      entityId: templateId,
      action: 'create',
      metadata: { name, duplicatedFrom: args.templateId },
    });
    return templateId;
  },
});

/** Soft: the campaigns and steps that loaded it keep their copy and their figures; the purge takes the row after the retention window. */
export const deleteEmailTemplate = employeeMutation({
  args: { templateId: v.id('emailTemplates') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const template = await loadEditable(ctx, args.templateId);
    await ctx.db.patch(args.templateId, {
      deletedAt: Date.now(),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'emailTemplate',
      entityId: args.templateId,
      action: 'delete',
      metadata: { name: template.name },
    });
    return null;
  },
});

/** The shipped templates, for a deployment set up before they existed; nothing when any template exists. */
export const ensureDefaults = settingsMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await ensureDefaultEmailTemplates(ctx, ctx.userId)).length,
});
