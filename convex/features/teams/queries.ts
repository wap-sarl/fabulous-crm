import { employeeQuery } from '../../_lib/auth';
import { isNotDeleted } from '../../lib';

/** Live teams with their members' names, for the settings screen and pickers. */
export const listTeams = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const teams = (await ctx.db.query('teams').collect()).filter(isNotDeleted);
    const names = new Map<string, string>();
    const out = [];
    for (const team of teams) {
      const members = [];
      for (const id of team.memberIds) {
        if (!names.has(id)) {
          const user = await ctx.db.get(id);
          if (user && isNotDeleted(user)) names.set(id, `${user.firstName} ${user.lastName}`);
        }
        const name = names.get(id);
        if (name) members.push({ _id: id, name });
      }
      out.push({ _id: team._id, name: team.name, memberIds: team.memberIds, members });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  },
});
