import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import { follows } from '../../_lib/validators/fields';
import {
  type NotificationChannelChoice,
  type NotificationKind,
  notificationKindOnByDefault,
} from '../../_lib/validators/notifications';
import { encryptSecret } from '../security/crypto';
import type { NotificationChannel } from './channels';

type Preferences = Doc<'notificationPreferences'> | null;

/** A person's choices, or null while they made none: everything is then as the catalogue says, and no external channel is on. */
export async function preferencesOf(
  ctx: Pick<QueryCtx, 'db'>,
  userId: Id<'users'>,
): Promise<Preferences> {
  return await ctx.db
    .query('notificationPreferences')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();
}

/** Whether the person is told this kind: their choice, else the catalogue's default. */
export const kindIsOn = (preferences: Preferences, kind: NotificationKind): boolean =>
  preferences?.kinds[kind] ?? notificationKindOnByDefault(kind);

/** Whether the person turned this channel on; an entry whose channel is no longer available stays in the row, and is not asked here. */
export const channelIsOn = (preferences: Preferences, key: string): boolean =>
  preferences?.channels[key]?.enabled === true;

/** The entry a choice becomes: the target checked against the channel's schema and kept as ciphertext when it is a secret; a choice that gives none keeps the one already there. */
export async function channelChoice(
  channel: NotificationChannel,
  choice: NotificationChannelChoice,
  previous: NotificationChannelChoice | undefined,
): Promise<NotificationChannelChoice> {
  const { target } = channel;
  if (!target) {
    if (choice.target !== undefined) throw refusal('invalid_channel_target');
    return { enabled: choice.enabled };
  }
  let stored = previous?.target;
  if (choice.target !== undefined) {
    if (!follows(target.schema, choice.target)) throw refusal('invalid_channel_target');
    stored = target.secret ? await encryptSecret(choice.target) : choice.target;
  }
  if (!stored) {
    if (choice.enabled) throw refusal('invalid_channel_target');
    return { enabled: false };
  }
  return { enabled: choice.enabled, target: stored };
}

/** Writes a person's choices over the ones they had. */
export async function savePreferences(
  ctx: MutationCtx,
  userId: Id<'users'>,
  previous: Preferences,
  next: Pick<Doc<'notificationPreferences'>, 'kinds' | 'channels'>,
): Promise<void> {
  const row = { ...next, updatedAt: Date.now() };
  if (previous) await ctx.db.patch(previous._id, row);
  else await ctx.db.insert('notificationPreferences', { userId, ...row });
}
