import { v } from 'convex/values';
import { adminMutation } from '../../_lib/auth';
import { employeeRoleValidator } from '../../_lib/validators/employees';
import { isNotDeleted, logAudit, updateAuditFields } from '../../lib';

/** Change an employee's role. An admin cannot change their own (no lock-out). */
export const setEmployeeRole = adminMutation({
  args: { userId: v.id('users'), role: employeeRoleValidator },
  handler: async (ctx, args) => {
    if (args.userId === ctx.userId) throw new Error('cannot_change_own_role');
    const user = await ctx.db.get(args.userId);
    if (user?.type !== 'employee' || !isNotDeleted(user)) throw new Error('user_not_found');
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
