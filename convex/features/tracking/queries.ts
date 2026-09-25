import { settingsQuery } from '../../_lib/auth';
import { loadTrackingConfig } from '../../lib/tracking';

/** The tracking settings and the numbers behind them, for the settings page. */
export const getTrackingSettings = settingsQuery({
  args: {},
  handler: async (ctx) => {
    const config = await loadTrackingConfig(ctx);
    // Small, bounded reads: a settings page, not a report.
    const visitors = await ctx.db.query('webVisitors').take(1001);
    const identified = visitors.filter((v) => v.leadId !== undefined).length;
    return {
      ...config,
      visitors: visitors.length > 1000 ? 1000 : visitors.length,
      visitorsCapped: visitors.length > 1000,
      identified,
    };
  },
});
