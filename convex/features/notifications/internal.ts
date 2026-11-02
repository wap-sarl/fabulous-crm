import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalMutation } from '../../_lib/functions';
import { NOTIFICATION_FAN_OUT_BATCH } from '../../_lib/validators/notifications';
import { deferUnlessAllowed } from '../../lib/extensions/gates';
import { fanOutEvent } from '../../lib/notifications/fanOut';

/** The unread rows one run marks read; a person with more gets another run. */
const MARK_READ_BATCH = 200;

/** Drains the pending facts, oldest first, a batch at a time; a full batch means more may wait, so the next run is scheduled. */
export const fanOut = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (
      await deferUnlessAllowed(
        ctx,
        'notification_fan_out',
        internal.features.notifications.internal.fanOut,
        {},
      )
    ) {
      return null;
    }
    const events = await ctx.db
      .query('notificationEvents')
      .withIndex('by_at')
      .order('asc')
      .take(NOTIFICATION_FAN_OUT_BATCH);
    for (const event of events) {
      await fanOutEvent(ctx, event);
      await ctx.db.delete(event._id);
    }
    if (events.length >= NOTIFICATION_FAN_OUT_BATCH) {
      await ctx.scheduler.runAfter(0, internal.features.notifications.internal.fanOut, {});
    }
    return null;
  },
});

/** Marks read what a person had unread when they asked, one batch per run; nothing that arrived since. */
export const markAllReadFor = internalMutation({
  args: { userId: v.id('users'), before: v.number(), at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_unread', (q) =>
        q.eq('userId', args.userId).eq('readAt', undefined).lte('createdAt', args.before),
      )
      .take(MARK_READ_BATCH);
    for (const row of unread) await ctx.db.patch(row._id, { readAt: args.at });
    if (unread.length >= MARK_READ_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.notifications.internal.markAllReadFor,
        args,
      );
    }
    return null;
  },
});
