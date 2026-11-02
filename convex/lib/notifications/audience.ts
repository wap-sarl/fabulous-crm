import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { resolveRoleAccess } from '../roles/access';

// Who a fact concerns: the owner, the assignee, a team, the settings-right holders; never « everyone ».

type Ctx = QueryCtx | MutationCtx;

/** The live employees whose role carries the settings right; one role resolution per distinct role. */
export async function settingsUsers(ctx: Ctx): Promise<Id<'users'>[]> {
  const employees = await ctx.db
    .query('users')
    .withIndex('by_type_deleted', (q) => q.eq('type', 'employee').eq('deletedAt', undefined))
    .collect();
  const byRole = new Map<string, boolean>();
  const holders: Id<'users'>[] = [];
  for (const employee of employees) {
    const role = employee.role ?? 'member';
    if (!byRole.has(role)) byRole.set(role, (await resolveRoleAccess(ctx, role)).access.settings);
    if (byRole.get(role)) holders.push(employee._id);
  }
  return holders;
}

/** The members of every live team one of `userIds` belongs to, `userIds` included. */
export async function teamMatesOf(ctx: Ctx, userIds: Id<'users'>[]): Promise<Id<'users'>[]> {
  const seed = new Set(userIds);
  const teams = await ctx.db.query('teams').collect();
  const mates = new Set(userIds);
  for (const team of teams) {
    if (team.deletedAt !== undefined || !team.memberIds.some((id) => seed.has(id))) continue;
    for (const id of team.memberIds) mates.add(id);
  }
  return [...mates];
}

/** The people to tell: distinct, live, and never the actor unless the kind reports the end of their own work. */
export async function recipientsOf(
  ctx: Ctx,
  candidates: Id<'users'>[],
  opts: { actorId?: Id<'users'>; tellActor?: boolean },
): Promise<Doc<'users'>[]> {
  const recipients: Doc<'users'>[] = [];
  for (const id of new Set(candidates)) {
    if (!opts.tellActor && id === opts.actorId) continue;
    const user = await ctx.db.get(id);
    if (user && user.type === 'employee' && user.deletedAt === undefined) recipients.push(user);
  }
  return recipients;
}
