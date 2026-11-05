import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { employeeMutation } from '../../_lib/auth';
import { refusal } from '../../_lib/refusal';
import { follows } from '../../_lib/validators/fields';
import {
  notificationChannelChoiceValidator,
  notificationKindChoicesSchema,
} from '../../_lib/validators/notifications';
import { availableChannels } from '../../lib/notifications/channels';
import { channelChoice, preferencesOf, savePreferences } from '../../lib/notifications/preferences';

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

/** The caller's own settings, the choices given written over the ones they had: known kinds, channels that can deliver now, a target the channel accepts. */
export const updateMyNotificationPreferences = employeeMutation({
  args: {
    kinds: v.optional(v.record(v.string(), v.boolean())),
    channels: v.optional(v.record(v.string(), notificationChannelChoiceValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!follows(notificationKindChoicesSchema, args.kinds ?? {})) {
      throw refusal('unknown_notification_kind');
    }
    const previous = await preferencesOf(ctx, ctx.userId);
    const channels = { ...previous?.channels };
    const available = await availableChannels(ctx);
    for (const [key, choice] of Object.entries(args.channels ?? {})) {
      const channel = available.find((entry) => entry.key === key);
      if (!channel) throw refusal('channel_not_available');
      channels[key] = await channelChoice(channel, choice, channels[key]);
    }
    await savePreferences(ctx, ctx.userId, previous, {
      kinds: { ...previous?.kinds, ...args.kinds },
      channels,
    });
    return null;
  },
});
