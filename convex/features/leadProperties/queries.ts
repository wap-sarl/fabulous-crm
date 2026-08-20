import { employeeQuery } from '../../_lib/auth';
import { isNotDeleted, sortByOrder } from '../../lib';

/**
 * All active custom property definitions, ordered. One query feeds the lead
 * form, table, detail page, toolbar filters, and the admin settings screen.
 * Read access is any employee; writes (mutations) are admin-only.
 */
export const listDefinitions = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('leadPropertyDefinitions').collect();
    return all.filter(isNotDeleted).sort(sortByOrder);
  },
});
