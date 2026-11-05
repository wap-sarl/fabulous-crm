import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  NOTIFICATION_DELIVERY_BACKOFF_MS,
  NOTIFICATION_DELIVERY_HOLD_MS,
} from '../../_lib/validators/notifications';
import { scheduledWorkAllowed } from '../extensions/gates';
import { SCHEDULED_WORK_RETRY_MS } from '../extensions/types';
import { loadVisibility } from '../roles/visibility';
import { decryptSecret } from '../security/crypto';
import { canOpenRecord } from './access';
import { availableChannels, channelOf, type NotificationChannel } from './channels';
import { channelIsOn, kindIsOn, preferencesOf } from './preferences';

// One row per notification and channel; the scheduler carries the hold and the retries, no cron polls them.

/** What a channel's action needs to send: the text, where the notification opens, and what reaches the person. */
export interface DeliveryJob {
  title: string;
  body: string;
  path: string;
  /** The person's target on the channel, in clear; the address of their account for a channel that asks for none. */
  to: string;
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
  const stored = preferences?.channels[channel.key]?.target;
  const to = !channel.target
    ? user.email
    : stored && channel.target.secret
      ? await decryptSecret(stored)
      : stored;
  if (!to) return await skip('no_target');
  await ctx.db.patch(deliveryId, { status: 'sending' });
  return { title: notification.title, body: notification.body, path: notification.path, to };
}

/** Records what became of a delivery that left: sent, skipped by the channel itself, or failed, which tries again after the next wait of the backoff and gives up after the last. */
export async function finishDelivery(
  ctx: MutationCtx,
  deliveryId: Id<'notificationDeliveries'>,
  result: 'sent' | 'skipped' | 'failed',
  error?: string,
): Promise<void> {
  const delivery = await ctx.db.get(deliveryId);
  if (delivery?.status !== 'sending') return;
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
