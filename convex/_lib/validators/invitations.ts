import { type Infer, v } from 'convex/values';

/**
 * Invitation-based membership allowlist. The first admin is bootstrapped by the
 * setup wizard (SETUP_TOKEN); every other user must have a `pending` invitation
 * whose email matches the verified email from their auth provider. Enforced in
 * the Better Auth `databaseHooks.user.create.before` hook (convex/auth.ts).
 */
export const invitationStatusValidator = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('revoked'),
);

export const invitationRoleValidator = v.union(v.literal('admin'), v.literal('member'));

export const invitationValidator = v.object({
  email: v.string(), // stored lowercased/trimmed; matched against the verified provider email
  role: invitationRoleValidator,
  status: invitationStatusValidator,
  invitedBy: v.optional(v.id('users')),
  invitedAt: v.number(),
  acceptedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
});

export type Invitation = Infer<typeof invitationValidator>;
export type InvitationStatus = Infer<typeof invitationStatusValidator>;
export type InvitationRole = Infer<typeof invitationRoleValidator>;
