import { v } from 'convex/values';
import { settingsQuery } from '../../_lib/auth';

/** The last purge run as its audit row reports it, for the settings page; null before the first run. */
export const lastPurge = settingsQuery({
  args: {},
  // The report is the audit row's metadata: counts by kind, free by the schema.
  returns: v.union(v.object({ at: v.number(), report: v.record(v.string(), v.any()) }), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query('auditLogs')
      .withIndex('by_entity', (q) => q.eq('entityType', 'retention').eq('entityId', 'purge'))
      .order('desc')
      .first();
    return row ? { at: row.timestamp, report: row.metadata as Record<string, unknown> } : null;
  },
});
