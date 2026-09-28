import { v } from 'convex/values';

/** An allowlist: past the first admin the setup wizard creates, a user needs a `pending` invitation matching the verified email of their auth provider (enforced in convex/auth.ts). */
const invitationStatusValidator = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('revoked'),
);

export const invitationRoleValidator = v.string();

export const invitationValidator = v.object({
  email: v.string(), // stored lowercased/trimmed; matched against the verified provider email
  role: invitationRoleValidator,
  status: invitationStatusValidator,
  invitedBy: v.optional(v.id('users')),
  invitedAt: v.number(),
  acceptedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
});
