import { v } from 'convex/values';
import { docOf } from '../../lib/shared/docs';
import { settingsQuery } from '../../_lib/auth';

/** Pending invitations, newest first (admin only). */
export const listInvitations = settingsQuery({
  args: {},
  returns: v.array(docOf('invitations')),
  handler: async (ctx) => {
    const invites = await ctx.db.query('invitations').collect();
    return invites.filter((i) => i.status === 'pending').sort((a, b) => b.invitedAt - a.invitedAt);
  },
});
