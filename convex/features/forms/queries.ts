import { v } from 'convex/values';
import { employeeQuery, settingsQuery } from '../../_lib/auth';
import { isNotDeleted } from '../../lib/dbHelpers';

/** Live forms for the settings list. Tiny table — read in full. */
export const listForms = settingsQuery({
  args: {},
  handler: async (ctx) => {
    const forms = (await ctx.db.query('forms').collect()).filter(isNotDeleted);
    return forms
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((form) => ({
        _id: form._id,
        name: form.name,
        active: form.active,
        fieldCount: form.fields.length,
        createdAt: form._creationTime,
      }));
  },
});

export const getForm = settingsQuery({
  args: { formId: v.id('forms') },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    return form && isNotDeleted(form) ? form : null;
  },
});

/** Name lookup for pickers (workflow trigger config) — every employee. */
export const listFormOptions = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const forms = (await ctx.db.query('forms').collect()).filter(isNotDeleted);
    return forms
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((form) => ({ _id: form._id, name: form.name }));
  },
});
