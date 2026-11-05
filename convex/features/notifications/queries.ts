import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_LATEST,
  NOTIFICATION_UNREAD_CAP,
  notificationGroupValidator,
  notificationKindValidator,
} from '../../_lib/validators/notifications';
import { availableChannels } from '../../lib/notifications/channels';
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

/** The settings page in one answer: every kind of the catalogue with the caller's choice or its default, and the channels that can deliver with theirs; a target is never returned. */
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
      }),
    ),
  }),
  handler: async (ctx) => {
    const preferences = await preferencesOf(ctx, ctx.userId);
    const channels = await availableChannels(ctx);
    return {
      kinds: NOTIFICATION_KINDS.map(({ key, group, label }) => ({
        key,
        group,
        label,
        on: kindIsOn(preferences, key),
      })),
      channels: channels.map(({ key, label, description }) => ({
        key,
        label,
        description,
        enabled: channelIsOn(preferences, key),
      })),
    };
  },
});
