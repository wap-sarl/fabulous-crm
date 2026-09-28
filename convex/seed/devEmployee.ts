import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

/** A fresh deployment has nobody who can sign in: this creates its first employee, or revives it. */
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
