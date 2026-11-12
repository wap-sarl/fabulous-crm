import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import { employeeQuery, settingsQuery } from '../../_lib/auth';
import {
  NOTIFICATION_LATEST,
  NOTIFICATION_UNREAD_CAP,
  notificationGroupValidator,
  notificationKindValidator,
  notificationKindsFor,
  notificationNamesValidator,
} from '../../_lib/validators/notifications';
import { availableChannels, channelNames, pluginChannel } from '../../lib/notifications/channels';
import { channelIsOn, kindIsOn, preferencesOf } from '../../lib/notifications/preferences';
import { docOf } from '../../lib/shared/docs';

const notificationRow = docOf('notifications');

/** The unread notifications of the caller, read up to the cap: the badge shows « 99+ » past it, a person who never reads never costs a full scan. */
export const unreadCount = employeeQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_unread', (q) => q.eq('userId', ctx.userId).eq('readAt', undefined))
      .take(NOTIFICATION_UNREAD_CAP);
    return unread.length;
  },
});

/** The popover: the unread first, the last delivered first, then the most recently read ones up to twenty. */
export const latest = employeeQuery({
  args: {},
  returns: v.array(notificationRow),
  handler: async (ctx) => {
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_unread', (q) => q.eq('userId', ctx.userId).eq('readAt', undefined))
      .order('desc')
      .take(NOTIFICATION_LATEST);
    if (unread.length >= NOTIFICATION_LATEST) return unread;
    const read = await ctx.db
      .query('notifications')
      .withIndex('by_user_unread', (q) => q.eq('userId', ctx.userId).gt('readAt', 0))
      .order('desc')
      .take(NOTIFICATION_LATEST - unread.length);
    return [...unread, ...read];
  },
});

/** The page: the whole history newest first, or the unread alone by delivery, one cursor page at a time. */
export const listMine = employeeQuery({
  args: { paginationOpts: paginationOptsValidator, unreadOnly: v.optional(v.boolean()) },
  returns: paginationResultValidator(notificationRow),
  handler: async (ctx, args) => {
    const query = args.unreadOnly
      ? ctx.db
          .query('notifications')
          .withIndex('by_user_unread', (q) => q.eq('userId', ctx.userId).eq('readAt', undefined))
      : ctx.db
          .query('notifications')
          .withIndex('by_user_created', (q) => q.eq('userId', ctx.userId));
    return await query.order('desc').paginate(args.paginationOpts);
  },
});

/** The settings page in one answer: the kinds the caller's role can receive, each with their choice or its default, and the channels that can deliver with theirs; a target is never returned. */
export const getMyNotificationPreferences = employeeQuery({
  args: {},
  returns: v.object({
    kinds: v.array(
      v.object({
        key: notificationKindValidator,
        group: notificationGroupValidator,
        label: v.string(),
        on: v.boolean(),
      }),
    ),
    channels: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        description: v.string(),
        enabled: v.boolean(),
        // What the channel asks the person for, and whether they gave it: `hint` is all that is said of a target kept.
        target: v.optional(
          v.object({
            label: v.string(),
            placeholder: v.string(),
            set: v.boolean(),
            hint: v.optional(v.string()),
            // When the service refused the target for good: the channel went off with it.
            refusedAt: v.optional(v.number()),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx) => {
    const preferences = await preferencesOf(ctx, ctx.userId);
    const channels = await availableChannels(ctx);
    return {
      kinds: notificationKindsFor(ctx.visibility.access).map(({ key, group, label }) => ({
        key,
        group,
        label,
        on: kindIsOn(preferences, key),
      })),
      channels: channels.map(({ key, label, description, target }) => {
        const choice = preferences?.channels[key];
        return {
          key,
          label,
          description,
          enabled: channelIsOn(preferences, key),
          ...(target && {
            target: {
              label: target.label,
              placeholder: target.placeholder,
              set: choice?.target !== undefined,
              ...(choice?.hint !== undefined && { hint: choice.hint }),
              ...(choice?.refusedAt !== undefined && { refusedAt: choice.refusedAt }),
            },
          }),
        };
      }),
    };
  },
});

/** A plugin's settings page: what the channel's messages may say, and whether the caller gave their own target, which « tester le canal » writes to; null once the plugin is uninstalled. */
export const getNotificationChannelSettings = settingsQuery({
  args: { channel: v.string() },
  returns: v.union(
    v.null(),
    v.object({ label: v.string(), names: notificationNamesValidator, targetSet: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    const channel = await pluginChannel(ctx, args.channel);
    if (!channel) return null;
    const preferences = await preferencesOf(ctx, ctx.userId);
    return {
      label: channel.label,
      names: await channelNames(ctx, channel),
      targetSet: preferences?.channels[channel.key]?.target !== undefined,
    };
  },
});
