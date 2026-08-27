import { v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';
import { propertyEntityTypeValidator } from '../../_lib/validators/properties';
import { isNotDeleted, sortByOrder } from '../../lib';
import { loadPropertyDefinitions } from '../../lib/properties';

export const listDefinitions = employeeQuery({
  args: { entityType: v.optional(propertyEntityTypeValidator) },
  handler: async (ctx, args) => {
    if (args.entityType) return await loadPropertyDefinitions(ctx, args.entityType);
    const all = await ctx.db.query('propertyDefinitions').collect();
    return all.filter(isNotDeleted).sort(sortByOrder);
  },
});
