import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import {
  type NotificationChannelChoice,
  type NotificationChannelChoiceArg,
  type NotificationKind,
  notificationKindOnByDefault,
} from '../../_lib/validators/notifications';
import { decryptSecret, encryptSecret } from '../security/crypto';
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

/** The entry a choice becomes: the target checked against the channel's schema and kept as ciphertext when it is a secret, with the part of it the page may show; a choice that gives none keeps the one already there, `null` takes it back and the channel goes off with it. A choice is a fresh entry: a refusal recorded on the last one is not carried over. */
export async function channelChoice(
  channel: NotificationChannel,
  choice: NotificationChannelChoiceArg,
  previous: NotificationChannelChoice | undefined,
): Promise<NotificationChannelChoice> {
  const { target } = channel;
  if (!target) {
    if (choice.target != null) throw refusal('invalid_channel_target');
    return { enabled: choice.enabled };
  }
  if (choice.target === null) return { enabled: false };
  let kept: Pick<NotificationChannelChoice, 'target' | 'hint'> | undefined = previous?.target
    ? { target: previous.target, ...(previous.hint !== undefined && { hint: previous.hint }) }
    : undefined;
  if (choice.target !== undefined) {
    const given = target.schema.safeParse(choice.target);
    if (!given.success) throw refusal('invalid_channel_target');
    kept = {
      target: target.secret ? await encryptSecret(given.data) : given.data,
      ...(target.hint && { hint: target.hint(given.data) }),
    };
  }
  if (!kept) {
    if (choice.enabled) throw refusal('invalid_channel_target');
    return { enabled: false };
  }
  return { enabled: choice.enabled, ...kept };
}

/** What reaches a person on a channel, in clear: the target they gave, or the address of their account for a channel that asks for none. `none` when there is nothing to write to, `unreadable` when the target kept can no longer be decrypted (a key that changed, a damaged ciphertext): the caller ends its work there, nothing is thrown. */
export async function targetOf(
  channel: NotificationChannel,
  user: Pick<Doc<'users'>, 'email'>,
  preferences: Preferences,
): Promise<{ to: string; stored: string } | 'none' | 'unreadable'> {
  const stored = channel.target ? preferences?.channels[channel.key]?.target : user.email;
  if (!stored) return 'none';
  if (!channel.target?.secret) return { to: stored, stored };
  try {
    return { to: await decryptSecret(stored), stored };
  } catch {
    return 'unreadable';
  }
}

/** The service refused a person's target for good: their channel goes off and says when, so that no later notification is sent to it and their page tells them why. A target they replaced while the message was leaving is not the one refused: nothing changes then. */
export async function markTargetRefused(
  ctx: MutationCtx,
  userId: Id<'users'>,
  key: string,
  refused: string | undefined,
): Promise<void> {
  const preferences = await preferencesOf(ctx, userId);
  const entry = preferences?.channels[key];
  if (!preferences || !entry || entry.target !== refused) return;
  await ctx.db.patch(preferences._id, {
    channels: {
      ...preferences.channels,
      [key]: { ...entry, enabled: false, refusedAt: Date.now() },
    },
    updatedAt: Date.now(),
  });
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
