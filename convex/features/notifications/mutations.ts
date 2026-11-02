import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { employeeMutation } from '../../_lib/auth';
import { refusal } from '../../_lib/refusal';

/** Opening a notification reads it; one that is not the caller's is not there. */
export const markRead = employeeMutation({
  args: { notificationId: v.id('notifications') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.notificationId);
    if (!row || row.userId !== ctx.userId) throw refusal('notification_not_found');
    if (row.readAt === undefined) await ctx.db.patch(row._id, { readAt: Date.now() });
    return null;
  },
});

/** « Tout marquer comme lu »: what is unread now, in scheduled batches, so a long backlog never fails the click. */
export const markAllRead = employeeMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    await ctx.scheduler.runAfter(0, internal.features.notifications.internal.markAllReadFor, {
      userId: ctx.userId,
      before: now,
      at: now,
    });
    return null;
  },
});
