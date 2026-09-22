import { settingsQuery } from '../../_lib/auth';

/** The last purge run as its audit row reports it, for the settings page; null before the first run. */
export const lastPurge = settingsQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('auditLogs')
      .withIndex('by_entity', (q) => q.eq('entityType', 'retention').eq('entityId', 'purge'))
      .order('desc')
      .first();
    return row ? { at: row.timestamp, report: row.metadata as Record<string, unknown> } : null;
  },
});
