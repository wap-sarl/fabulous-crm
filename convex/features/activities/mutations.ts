import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { employeeMutation } from '../../_lib/auth';
import { activityTypeValidator } from '../../_lib/validators/activities';
import { propertyValueValidator } from '../../_lib/validators/properties';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../lib/properties/definitions';
import { computeChanges, logAudit, updateAuditFields } from '../../lib/audit/log';
import { filterUndefined } from '../../lib/shared/db';
import {
  createActivityRecord,
  loadActivity,
  requireActivityLinks,
} from '../../lib/activities/records';

const activityFieldArgs = {
  type: activityTypeValidator,
  title: v.string(),
  description: v.optional(v.string()),
  dueAt: v.optional(v.number()),
  ownerId: v.optional(v.union(v.id('users'), v.null())),
  teamId: v.optional(v.id('teams')),
  leadId: v.optional(v.id('leads')),
  companyId: v.optional(v.id('companies')),
  dealId: v.optional(v.id('deals')),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
} as const;

async function requireTeam(ctx: MutationCtx, teamId: Id<'teams'> | undefined) {
  if (!teamId) return;
  const team = await ctx.db.get(teamId);
  if (!team || team.deletedAt !== undefined) throw refusal('team_not_found');
}

/** Plan an activity (task, meeting, call to make…). Defaults to the caller as owner. */
export const createActivity = employeeMutation({
  args: activityFieldArgs,
  returns: v.id('activities'),
  handler: async (ctx, args) => {
    if (args.ownerId && !(await ctx.db.get(args.ownerId))) throw refusal('invalid_owner');
    await requireTeam(ctx, args.teamId);
    return await createActivityRecord(
      ctx,
      {
        ...args,
        // Default owner: the caller — unless the task is handed to a team or explicitly to nobody.
        ownerId:
          args.ownerId === null
            ? undefined
            : (args.ownerId ?? (args.teamId ? undefined : ctx.userId)),
        customProperties: sanitizeCustomProperties(
          await loadPropertyDefsById(ctx, 'activity'),
          args.customProperties,
        ),
      },
      { changedBy: ctx.userId },
    );
  },
});

export const logCall = employeeMutation({
  args: {
    leadId: v.optional(v.id('leads')),
    companyId: v.optional(v.id('companies')),
    dealId: v.optional(v.id('deals')),
    outcome: v.string(),
    notes: v.optional(v.string()),
    followUp: v.optional(v.object({ title: v.string(), dueAt: v.optional(v.number()) })),
  },
  returns: v.object({
    callId: v.id('activities'),
    followUpId: v.union(v.id('activities'), v.null()),
  }),
  handler: async (ctx, args) => {
    if (!args.leadId && !args.companyId && !args.dealId) throw refusal('activity_link_required');
    const links = { leadId: args.leadId, companyId: args.companyId, dealId: args.dealId };
    const callId = await createActivityRecord(
      ctx,
      {
        type: 'call',
        title: 'Appel',
        description: args.notes,
        status: 'done',
        outcome: args.outcome,
        ownerId: ctx.userId,
        ...links,
      },
      { changedBy: ctx.userId },
    );
    let followUpId = null;
    if (args.followUp) {
      followUpId = await createActivityRecord(
        ctx,
        {
          type: 'task',
          title: args.followUp.title,
          dueAt: args.followUp.dueAt,
          ownerId: ctx.userId,
          ...links,
        },
        { changedBy: ctx.userId },
      );
    }
    return { callId, followUpId };
  },
});

export const updateActivity = employeeMutation({
  args: {
    activityId: v.id('activities'),
    type: v.optional(activityTypeValidator),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    dueAt: v.optional(v.union(v.number(), v.null())),
    ownerId: v.optional(v.union(v.id('users'), v.null())),
    teamId: v.optional(v.union(v.id('teams'), v.null())),
    leadId: v.optional(v.union(v.id('leads'), v.null())),
    companyId: v.optional(v.union(v.id('companies'), v.null())),
    dealId: v.optional(v.union(v.id('deals'), v.null())),
    outcome: v.optional(v.union(v.string(), v.null())),
    customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
  },
  returns: v.id('activities'),
  handler: async (ctx, args) => {
    const { activityId, customProperties, ...rest } = args;
    const activity = await loadActivity(ctx, activityId);
    if (rest.title !== undefined && !rest.title.trim()) throw refusal('activity_title_required');
    if (rest.ownerId && !(await ctx.db.get(rest.ownerId))) throw refusal('invalid_owner');
    await requireTeam(ctx, rest.teamId ?? undefined);
    await requireActivityLinks(ctx, {
      leadId: rest.leadId ?? undefined,
      companyId: rest.companyId ?? undefined,
      dealId: rest.dealId ?? undefined,
    });
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      // null clears the optional field (patching undefined removes it).
      updates[key] = value === null ? undefined : typeof value === 'string' ? value.trim() : value;
    }
    if (customProperties !== undefined) {
      updates.customProperties = sanitizeCustomProperties(
        await loadPropertyDefsById(ctx, 'activity'),
        customProperties,
      );
    }
    const changes = computeChanges(activity, filterUndefined(updates));
    await ctx.db.patch(activityId, { ...updates, ...updateAuditFields(ctx.userId) });
    if (changes) {
      await logAudit({
        ctx,
        userId: ctx.userId,
        entityType: 'activity',
        entityId: activityId,
        action: 'update',
        metadata: { changes },
      });
    }
    return activityId;
  },
});

/** Complete an activity, recording what came out of it. */
export const completeActivity = employeeMutation({
  args: { activityId: v.id('activities'), outcome: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const activity = await loadActivity(ctx, args.activityId);
    if (activity.status === 'done') return null;
    await ctx.db.patch(args.activityId, {
      status: 'done',
      completedAt: Date.now(),
      outcome: args.outcome?.trim() || activity.outcome,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'activity',
      entityId: args.activityId,
      action: 'update',
      metadata: { changes: { status: { old: activity.status, new: 'done' } } },
    });
    return null;
  },
});

/** Put a done or cancelled activity back in the queue. */
export const reopenActivity = employeeMutation({
  args: { activityId: v.id('activities') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const activity = await loadActivity(ctx, args.activityId);
    if (activity.status === 'open') return null;
    await ctx.db.patch(args.activityId, {
      status: 'open',
      completedAt: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'activity',
      entityId: args.activityId,
      action: 'update',
      metadata: { changes: { status: { old: activity.status, new: 'open' } } },
    });
    return null;
  },
});

export const cancelActivity = employeeMutation({
  args: { activityId: v.id('activities') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const activity = await loadActivity(ctx, args.activityId);
    if (activity.status === 'cancelled') return null;
    await ctx.db.patch(args.activityId, { status: 'cancelled', ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'activity',
      entityId: args.activityId,
      action: 'update',
      metadata: { changes: { status: { old: activity.status, new: 'cancelled' } } },
    });
    return null;
  },
});

export const deleteActivity = employeeMutation({
  args: { activityId: v.id('activities') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadActivity(ctx, args.activityId);
    await ctx.db.patch(args.activityId, {
      deletedAt: Date.now(),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'activity',
      entityId: args.activityId,
      action: 'delete',
    });
    return null;
  },
});
