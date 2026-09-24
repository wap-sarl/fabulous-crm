import { v } from 'convex/values';
import { settingsQuery } from '../../_lib/auth';

/** The requests handled for one contact, newest first, for the lead page. */
export const listRequests = settingsQuery({
  args: { leadId: v.id('leads') },
  handler: async (ctx, { leadId }) => {
    const rows = await ctx.db
      .query('rgpdRequests')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .order('desc')
      .take(50);
    const out = [];
    for (const row of rows) {
      const by = await ctx.db.get(row.requestedBy);
      out.push({
        _id: row._id,
        type: row.type,
        requestedAt: row.requestedAt,
        completedAt: row.completedAt ?? null,
        outcome: row.outcome,
        requestedBy: by ? `${by.firstName} ${by.lastName}` : null,
      });
    }
    return out;
  },
});
