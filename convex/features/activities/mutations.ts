import { v } from 'convex/values';
import { employeeMutation } from '../../_lib/auth';
import { activityTypeValidator } from '../../_lib/validators/activities';
import { computeChanges, filterUndefined, logAudit, updateAuditFields } from '../../lib';
import { createActivityRecord, loadActivity, requireActivityLinks } from '../../lib/activities';

const activityFieldArgs = {
  type: activityTypeValidator,
  title: v.string(),
  description: v.optional(v.string()),
  dueAt: v.optional(v.number()),
  ownerId: v.optional(v.id('users')),
  leadId: v.optional(v.id('leads')),
  companyId: v.optional(v.id('companies')),
  dealId: v.optional(v.id('deals')),
} as const;

/** Plan an activity (task, meeting, call to make…). Defaults to the caller as owner. */
export const createActivity = employeeMutation({
  args: activityFieldArgs,
  handler: async (ctx, args) => {
    if (args.ownerId && !(await ctx.db.get(args.ownerId))) throw new Error('invalid_owner');
    return await createActivityRecord(
      ctx,
      { ...args, ownerId: args.ownerId ?? ctx.userId },
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
  handler: async (ctx, args) => {
    if (!args.leadId && !args.companyId && !args.dealId) throw new Error('activity_link_required');
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
    ownerId: v.optional(v.id('users')),
    leadId: v.optional(v.union(v.id('leads'), v.null())),
    companyId: v.optional(v.union(v.id('companies'), v.null())),
    dealId: v.optional(v.union(v.id('deals'), v.null())),
    outcome: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { activityId, ...rest } = args;
    const activity = await loadActivity(ctx, activityId);
    if (rest.title !== undefined && !rest.title.trim()) throw new Error('activity_title_required');
    if (rest.ownerId && !(await ctx.db.get(rest.ownerId))) throw new Error('invalid_owner');
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
  handler: async (ctx, args) => {
    const activity = await loadActivity(ctx, args.activityId);
    if (activity.status === 'done') return;
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
  },
});

/** Put a done or cancelled activity back in the queue. */
export const reopenActivity = employeeMutation({
  args: { activityId: v.id('activities') },
  handler: async (ctx, args) => {
    const activity = await loadActivity(ctx, args.activityId);
    if (activity.status === 'open') return;
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
  },
});

export const cancelActivity = employeeMutation({
  args: { activityId: v.id('activities') },
  handler: async (ctx, args) => {
    const activity = await loadActivity(ctx, args.activityId);
    if (activity.status === 'cancelled') return;
    await ctx.db.patch(args.activityId, { status: 'cancelled', ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'activity',
      entityId: args.activityId,
      action: 'update',
      metadata: { changes: { status: { old: activity.status, new: 'cancelled' } } },
    });
  },
});

export const deleteActivity = employeeMutation({
  args: { activityId: v.id('activities') },
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
  },
});
