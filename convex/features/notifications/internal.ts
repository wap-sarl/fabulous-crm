import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalMutation } from '../../_lib/functions';
import { NOTIFICATION_FAN_OUT_BATCH } from '../../_lib/validators/notifications';
import { scheduledWorkAllowed } from '../../lib/extensions/gates';
import { SCHEDULED_WORK_RETRY_MS } from '../../lib/extensions/types';
import { ensureFanOut } from '../../lib/notifications/emit';
import { beginDelivery, finishDelivery } from '../../lib/notifications/deliveries';
import { fanOutEvent, newFanOutRun } from '../../lib/notifications/fanOut';

/** The unread rows one run marks read; a person with more gets another run. */
const MARK_READ_BATCH = 200;

/** Drains the pending facts, oldest first, a batch at a time; whatever is left afterwards, arrived meanwhile included, gets the next run. Deferred, it comes back later as the one pending run. */
export const fanOut = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!(await scheduledWorkAllowed(ctx, 'notification_fan_out'))) {
      await ensureFanOut(ctx, SCHEDULED_WORK_RETRY_MS);
      return null;
    }
    const events = await ctx.db
      .query('notificationEvents')
      .withIndex('by_at')
      .order('asc')
      .take(NOTIFICATION_FAN_OUT_BATCH);
    const run = newFanOutRun();
    for (const event of events) {
      await fanOutEvent(ctx, event, run);
      await ctx.db.delete(event._id);
    }
    const left = await ctx.db.query('notificationEvents').withIndex('by_at').first();
    if (left) await ensureFanOut(ctx, 0);
    return null;
  },
});

/** Marks read what a person had in their inbox when they asked, one batch per run; a row delivered since, whatever the age of its fact, stays unread. */
export const markAllReadFor = internalMutation({
  args: { userId: v.id('users'), before: v.number(), at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_unread', (q) =>
        q.eq('userId', args.userId).eq('readAt', undefined).lte('deliveredAt', args.before),
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

/** First step of a channel's delivery action: what to send, or null when the delivery must not leave now. */
export const beginNotificationDelivery = internalMutation({
  args: { deliveryId: v.id('notificationDeliveries') },
  returns: v.union(
    v.null(),
    v.object({ title: v.string(), body: v.string(), path: v.string(), to: v.string() }),
  ),
  handler: async (ctx, args) => await beginDelivery(ctx, args.deliveryId),
});

/** Last step of a channel's delivery action: what became of it. */
export const finishNotificationDelivery = internalMutation({
  args: {
    deliveryId: v.id('notificationDeliveries'),
    result: v.union(v.literal('sent'), v.literal('skipped'), v.literal('failed')),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await finishDelivery(ctx, args.deliveryId, args.result, args.error);
    return null;
  },
});
