import { type Infer, v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';
import { isNotDeleted } from '../../lib/shared/db';

/** Live teams with their members' names, for the settings screen and pickers. */
const teamRow = v.object({
  _id: v.id('teams'),
  name: v.string(),
  memberIds: v.array(v.id('users')),
  members: v.array(v.object({ _id: v.id('users'), name: v.string() })),
});

export const listTeams = employeeQuery({
  args: {},
  returns: v.array(teamRow),
  handler: async (ctx) => {
    const teams = (await ctx.db.query('teams').collect()).filter(isNotDeleted);
    const names = new Map<string, string>();
    const out: Infer<typeof teamRow>[] = [];
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
