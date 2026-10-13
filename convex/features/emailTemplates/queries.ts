import { v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';
import { templateScopeValidator } from '../../_lib/validators/emailTemplates';
import {
  emailTemplateUsage,
  listEmailTemplates,
  loadEmailTemplate,
} from '../../lib/templates/records';

const templateRow = v.object({
  _id: v.id('emailTemplates'),
  name: v.string(),
  subject: v.string(),
  htmlBody: v.string(),
  category: v.optional(v.string()),
  ownerId: v.id('users'),
  ownerName: v.union(v.string(), v.null()),
  scope: templateScopeValidator,
  updatedAt: v.number(),
  // Whether the caller may change it: its owner, or anyone with the settings right.
  editable: v.boolean(),
});

/** The templates in the caller's reach, newest first: the library and the pickers read the same list. */
export const listEmailTemplates_ = employeeQuery({
  args: {},
  returns: v.array(templateRow),
  handler: async (ctx) => {
    const rows = await listEmailTemplates(ctx);
    const owners = new Map<string, string | null>();
    const result = [];
    for (const row of rows) {
      let ownerName = owners.get(row.ownerId);
      if (ownerName === undefined) {
        const owner = await ctx.db.get(row.ownerId);
        ownerName = owner ? `${owner.firstName} ${owner.lastName}` : null;
        owners.set(row.ownerId, ownerName);
      }
      result.push({
        _id: row._id,
        name: row.name,
        subject: row.subject,
        htmlBody: row.htmlBody,
        category: row.category,
        ownerId: row.ownerId,
        ownerName,
        scope: row.scope,
        updatedAt: row.updatedAt,
        editable: row.ownerId === ctx.userId || ctx.visibility.access.settings,
      });
    }
    return result;
  },
});
export { listEmailTemplates_ as listEmailTemplates };

/** What a template has been used for, read through the caller's reach: the campaigns and workflows they may see. */
export const getEmailTemplateUsage = employeeQuery({
  args: { templateId: v.id('emailTemplates') },
  returns: v.object({
    campaigns: v.number(),
    workflows: v.number(),
    sent: v.number(),
    opened: v.number(),
    clicked: v.number(),
    partial: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await loadEmailTemplate(ctx, args.templateId);
    return await emailTemplateUsage(ctx, args.templateId);
  },
});
