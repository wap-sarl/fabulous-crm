import { employeeQuery } from '../../_lib/auth';
import { isNotDeleted } from '../../_lib/softDelete';

export const listEmployees = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const employees = await ctx.db
      .query('users')
      .withIndex('by_type', (q) => q.eq('type', 'employee'))
      .collect();

    return employees.filter((e) => e.type === 'employee' && isNotDeleted(e));
  },
});
