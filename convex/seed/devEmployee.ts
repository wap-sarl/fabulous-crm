import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

/**
 * Bootstrap: create (or revive) an employee so a fresh deployment has someone
 * who can log into the CRM. Run with:
 *   bunx convex run seed/devEmployee:createDevEmployee '{"email":"you@example.com","firstName":"You","lastName":"Example"}'
 * then mint a session with seed/devSession:createDevSession.
 */
export const createDevEmployee = internalMutation({
  args: {
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email_type', (q) =>
        q.eq('email', email).eq('type', 'employee').eq('deletedAt', undefined),
      )
      .first();
    if (existing) return { userId: existing._id, created: false };

    const userId = await ctx.db.insert('users', {
      type: 'employee',
      email,
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      birthDate: '1970-01-01',
      jobTitle: 'CRM',
      phone: '',
      address: { street: '', streetNumber: '', postalCode: '', city: '', country: 'FR' },
      updatedAt: Date.now(),
    });
    return { userId, created: true };
  },
});
