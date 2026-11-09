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

/** The entry a choice becomes: the target checked against the channel's schema and kept as ciphertext when it is a secret, with the part of it the page may show; a choice that gives none keeps the one already there, `null` takes it back and the channel goes off with it. */
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

/** What reaches a person on a channel, in clear: the target they gave, or the address of their account for a channel that asks for none. */
export async function targetOf(
  channel: NotificationChannel,
  user: Pick<Doc<'users'>, 'email'>,
  preferences: Preferences,
): Promise<string | undefined> {
  if (!channel.target) return user.email;
  const stored = preferences?.channels[channel.key]?.target;
  return stored && channel.target.secret ? await decryptSecret(stored) : stored;
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
