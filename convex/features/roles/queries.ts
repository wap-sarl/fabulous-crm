import { employeeQuery } from '../../_lib/auth';
import { ADMIN_ACCESS, ADMIN_ROLE_KEY, DEFAULT_ROLES } from '../../_lib/validators/roles';
import { isNotDeleted } from '../../lib';

export const listRoles = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('roles').collect();
    const users = (
      await ctx.db
        .query('users')
        .withIndex('by_type', (q) => q.eq('type', 'employee'))
        .collect()
    ).filter(isNotDeleted);
    const teams = (await ctx.db.query('teams').collect()).filter(isNotDeleted);
    const inTeam = new Set(teams.flatMap((t) => t.memberIds as string[]));

    const byKey = new Map(rows.map((r) => [r.key, r]));
    const roles = [
      ...DEFAULT_ROLES.map((d) => {
        const row = byKey.get(d.key);
        return {
          key: d.key,
          label: row?.label ?? d.label,
          access: d.key === ADMIN_ROLE_KEY ? ADMIN_ACCESS : (row?.access ?? d.access),
          builtIn: true,
        };
      }),
      ...rows
        .filter((r) => !DEFAULT_ROLES.some((d) => d.key === r.key))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
        .map((r) => ({ key: r.key, label: r.label, access: r.access, builtIn: false })),
    ];
    return roles.map((role) => {
      const holders = users.filter((u) => (u.role ?? 'member') === role.key);
      return {
        ...role,
        userCount: holders.length,
        usersWithoutTeam: holders.filter((u) => !inTeam.has(u._id)).length,
      };
    });
  },
});
