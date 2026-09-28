import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';

/** The membership gate of the Better Auth user-creation hook: only an active employee or a pending invitation may create an account. */
export const isAllowed = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();

    const employee = await ctx.db
      .query('users')
      .withIndex('by_email_type', (q) =>
        q.eq('email', normalized).eq('type', 'employee').eq('deletedAt', undefined),
      )
      .first();
    if (employee) return true;

    const invite = await ctx.db
      .query('invitations')
      .withIndex('by_email_status', (q) => q.eq('email', normalized).eq('status', 'pending'))
      .first();
    return !!invite;
  },
});
