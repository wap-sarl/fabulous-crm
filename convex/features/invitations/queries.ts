import { adminQuery } from '../../_lib/auth';

/** Pending invitations, newest first (admin only). */
export const listInvitations = adminQuery({
  args: {},
  handler: async (ctx) => {
    const invites = await ctx.db.query('invitations').collect();
    return invites
      .filter((i) => i.status === 'pending')
      .sort((a, b) => b.invitedAt - a.invitedAt);
  },
});
