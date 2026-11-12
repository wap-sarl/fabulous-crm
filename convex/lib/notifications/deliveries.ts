import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  NOTIFICATION_DELIVERY_BACKOFF_MS,
  NOTIFICATION_DELIVERY_HOLD_MS,
  NOTIFICATION_DELIVERY_TIMEOUT_MS,
  notificationKindLabel,
} from '../../_lib/validators/notifications';
import { scheduledWorkAllowed } from '../extensions/gates';
import { SCHEDULED_WORK_RETRY_MS } from '../extensions/types';
import { loadVisibility } from '../roles/visibility';
import { canOpenRecord } from './access';
import { availableChannels, channelNames, channelOf, type NotificationChannel } from './channels';
import { channelIsOn, kindIsOn, markTargetRefused, preferencesOf, targetOf } from './preferences';

// One row per notification and channel; the scheduler carries the hold and the retries, no cron polls them.

/** What a channel's action needs to send: the text, where the notification opens, and what reaches the person. */
export interface DeliveryJob {
  channel: string;
  title: string;
  body: string;
  path: string;
  /** The person's target on the channel, in clear; the address of their account for a channel that asks for none. */
  to: string;
  /** The target as the person's row keeps it, for a channel that asks for one: a refusal names it, so that one replaced meanwhile is left alone. */
  target?: string;
}

/** Queues one delivery of an inbox row per channel its reader turned on; a row refreshed while a delivery is still pending adds none, whatever its deadline: that one reads the row when it leaves. One already sending has read its text, so the change gets a delivery of its own. */
export async function queueDeliveries(
  ctx: MutationCtx,
  channels: NotificationChannel[],
  preferences: Doc<'notificationPreferences'> | null,
  notificationId: Id<'notifications'>,
): Promise<void> {
  const now = Date.now();
  for (const channel of channels) {
    if (!channelIsOn(preferences, channel.key)) continue;
    const waiting = await ctx.db
      .query('notificationDeliveries')
      .withIndex('by_notification', (q) =>
        q.eq('notificationId', notificationId).eq('channel', channel.key).eq('status', 'pending'),
      )
      .first();
    if (waiting) continue;
    const deliveryId = await ctx.db.insert('notificationDeliveries', {
      notificationId,
      channel: channel.key,
      status: 'pending',
      attempts: 0,
      nextAt: now + NOTIFICATION_DELIVERY_HOLD_MS,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(NOTIFICATION_DELIVERY_HOLD_MS, channel.deliver, { deliveryId });
  }
}

/** What a delivery about to leave sends, or null when it must not leave: deferred by the gate, it comes back later; refused for a reason that cannot change, it is `skipped` at once. Everything is asked again here, as it stands now: the hold, a retry or a deferral may have let the person change their mind or lose the record. */
export async function beginDelivery(
  ctx: MutationCtx,
  deliveryId: Id<'notificationDeliveries'>,
): Promise<DeliveryJob | null> {
  const delivery = await ctx.db.get(deliveryId);
  if (delivery?.status !== 'pending') return null;
  const skip = async (error: string) => {
    await ctx.db.patch(deliveryId, { status: 'skipped', error });
    return null;
  };
  const channel = channelOf(delivery.channel);
  if (!channel) return await skip('channel_not_available');
  if (!(await scheduledWorkAllowed(ctx, 'notification_delivery'))) {
    await ctx.db.patch(deliveryId, { nextAt: Date.now() + SCHEDULED_WORK_RETRY_MS });
    await ctx.scheduler.runAfter(SCHEDULED_WORK_RETRY_MS, channel.deliver, { deliveryId });
    return null;
  }
  const notification = await ctx.db.get(delivery.notificationId);
  if (!notification) return await skip('notification_gone');
  // Read in the app while the delivery waited: the message would only repeat what the person saw.
  if (notification.readAt !== undefined) return await skip('read');
  const user = await ctx.db.get(notification.userId);
  if (!user || user.deletedAt !== undefined) return await skip('recipient_gone');
  const available = await availableChannels(ctx);
  if (!available.includes(channel)) return await skip('channel_not_available');
  const preferences = await preferencesOf(ctx, user._id);
  if (!channelIsOn(preferences, channel.key)) return await skip('channel_disabled');
  if (!kindIsOn(preferences, notification.kind)) return await skip('kind_disabled');
  // Outside the app the record's name cannot be taken back: a reader who lost the record is not written to.
  if (notification.record) {
    const visibility = await loadVisibility(ctx, user);
    if (!(await canOpenRecord(ctx, visibility, notification.record))) {
      return await skip('access_lost');
    }
  }
  const target = await targetOf(channel, user, preferences);
  if (target === 'none') return await skip('no_target');
  // Thrown here, the error would roll this back and leave the row pending for good: nothing else ends it.
  if (target === 'unreadable') return await skip('target_unreadable');
  const bare = (await channelNames(ctx, channel)) === 'none';
  await ctx.db.patch(deliveryId, { status: 'sending' });
  // An action that stops before recording its result would leave the row sending for good: this ends it.
  await ctx.scheduler.runAfter(
    NOTIFICATION_DELIVERY_TIMEOUT_MS,
    internal.features.notifications.internal.expireNotificationDelivery,
    { deliveryId, attempts: delivery.attempts },
  );
  return {
    channel: channel.key,
    // Without names, the message says what kind of thing happened and where to read it.
    title: bare ? notificationKindLabel(notification.kind) : notification.title,
    body: bare ? '' : notification.body,
    path: notification.path,
    to: target.to,
    target: channel.target ? target.stored : undefined,
  };
}

/** Records what became of a delivery that left: sent, skipped by the channel itself, refused for good by the service, which also turns the person's channel off, or failed, which tries again after the next wait of the backoff and gives up after the last. */
export async function finishDelivery(
  ctx: MutationCtx,
  deliveryId: Id<'notificationDeliveries'>,
  result: 'sent' | 'skipped' | 'refused' | 'failed',
  error?: string,
  target?: string,
): Promise<void> {
  const delivery = await ctx.db.get(deliveryId);
  if (delivery?.status !== 'sending') return;
  if (result === 'refused') {
    await ctx.db.patch(deliveryId, { status: 'skipped', error: 'target_refused' });
    const notification = await ctx.db.get(delivery.notificationId);
    if (notification) await markTargetRefused(ctx, notification.userId, delivery.channel, target);
    return;
  }
  if (result === 'skipped') {
    await ctx.db.patch(deliveryId, { status: 'skipped', error });
    return;
  }
  const attempts = delivery.attempts + 1;
  if (result === 'sent') {
    await ctx.db.patch(deliveryId, { status: 'sent', attempts, error: undefined });
    return;
  }
  const wait = NOTIFICATION_DELIVERY_BACKOFF_MS[delivery.attempts];
  const channel = channelOf(delivery.channel);
  if (wait === undefined || !channel) {
    await ctx.db.patch(deliveryId, { status: 'failed', attempts, error });
    return;
  }
  await ctx.db.patch(deliveryId, {
    status: 'pending',
    attempts,
    nextAt: Date.now() + wait,
    error,
  });
  await ctx.scheduler.runAfter(wait, channel.deliver, { deliveryId });
}

/** Ends a delivery whose send was interrupted: still sending, on the same attempt, long after an action could have lived. Not tried again, the message may have left. */
export async function expireDelivery(
  ctx: MutationCtx,
  deliveryId: Id<'notificationDeliveries'>,
  attempts: number,
): Promise<void> {
  const delivery = await ctx.db.get(deliveryId);
  if (delivery?.status !== 'sending' || delivery.attempts !== attempts) return;
  await ctx.db.patch(deliveryId, {
    status: 'failed',
    attempts: attempts + 1,
    error: 'interrupted',
  });
}
