import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { settingsMutation } from '../../_lib/auth';
import { MAX_TEAM_NAME_LENGTH } from '../../_lib/validators/teams';
import {
  computeChanges,
  createAuditFields,
  isNotDeleted,
  logAudit,
  updateAuditFields,
} from '../../lib';

function cleanName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error('team_name_required');
  if (name.length > MAX_TEAM_NAME_LENGTH) throw new Error('team_name_too_long');
  return name;
}

/** Deduplicated, live employees only. */
async function cleanMembers(ctx: MutationCtx, memberIds: Id<'users'>[]): Promise<Id<'users'>[]> {
  const out: Id<'users'>[] = [];
  for (const id of new Set(memberIds)) {
    const user = await ctx.db.get(id);
    if (user?.type !== 'employee' || !isNotDeleted(user)) throw new Error('invalid_member');
    out.push(id);
  }
  return out;
}

export const createTeam = settingsMutation({
  args: { name: v.string(), memberIds: v.array(v.id('users')) },
  handler: async (ctx, args) => {
    const teamId = await ctx.db.insert('teams', {
      name: cleanName(args.name),
      memberIds: await cleanMembers(ctx, args.memberIds),
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'team',
      entityId: teamId,
      action: 'create',
    });
    return teamId;
  },
});

export const updateTeam = settingsMutation({
  args: {
    teamId: v.id('teams'),
    name: v.optional(v.string()),
    memberIds: v.optional(v.array(v.id('users'))),
  },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team || !isNotDeleted(team)) throw new Error('team_not_found');
    const updates: { name?: string; memberIds?: Id<'users'>[] } = {};
    if (args.name !== undefined) updates.name = cleanName(args.name);
    if (args.memberIds !== undefined) updates.memberIds = await cleanMembers(ctx, args.memberIds);
    const changes = computeChanges(team, updates);
    await ctx.db.patch(args.teamId, { ...updates, ...updateAuditFields(ctx.userId) });
    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'team',
        entityId: args.teamId,
        action: 'update',
        metadata: { changes },
      });
    }
    return args.teamId;
  },
});

/** Soft delete; the managers who were in it lose that perimeter immediately. */
export const deleteTeam = settingsMutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team || !isNotDeleted(team)) throw new Error('team_not_found');
    await ctx.db.patch(args.teamId, { deletedAt: Date.now(), ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'team',
      entityId: args.teamId,
      action: 'delete',
    });
  },
});
