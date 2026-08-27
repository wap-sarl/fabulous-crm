import { v } from 'convex/values';
import { settingsMutation } from '../../_lib/auth';
import { employeeRoleValidator } from '../../_lib/validators/employees';
import { DEFAULT_ROLES } from '../../_lib/validators/roles';
import { findRole } from '../../lib/roles';
import { isNotDeleted, logAudit, updateAuditFields } from '../../lib';

/** Change an employee's role. An admin cannot change their own (no lock-out). */
export const setEmployeeRole = settingsMutation({
  args: { userId: v.id('users'), role: employeeRoleValidator },
  handler: async (ctx, args) => {
    if (args.userId === ctx.userId) throw new Error('cannot_change_own_role');
    const user = await ctx.db.get(args.userId);
    if (user?.type !== 'employee' || !isNotDeleted(user)) throw new Error('user_not_found');
    if (!(await findRole(ctx, args.role)) && !DEFAULT_ROLES.some((r) => r.key === args.role)) {
      throw new Error('invalid_role');
    }
    const previous = user.role ?? 'member';
    if (previous === args.role) return;
    await ctx.db.patch(args.userId, { role: args.role, ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'employee',
      entityId: args.userId,
      action: 'update',
      metadata: { changes: { role: { old: previous, new: args.role } } },
    });
  },
});
