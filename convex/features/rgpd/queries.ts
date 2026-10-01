import { rgpdRequestValidator } from '../../_lib/validators/rgpd';
import { type Infer, v } from 'convex/values';
import { settingsQuery } from '../../_lib/auth';

/** The requests handled for one contact, newest first, for the lead page. */
const requestRow = v.object({
  _id: v.id('rgpdRequests'),
  type: rgpdRequestValidator.fields.type,
  requestedAt: v.number(),
  completedAt: v.union(v.number(), v.null()),
  outcome: rgpdRequestValidator.fields.outcome,
  requestedBy: v.union(v.string(), v.null()),
});

export const listRequests = settingsQuery({
  args: { leadId: v.id('leads') },
  returns: v.array(requestRow),
  handler: async (ctx, { leadId }) => {
    const rows = await ctx.db
      .query('rgpdRequests')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .order('desc')
      .take(50);
    const out: Infer<typeof requestRow>[] = [];
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
