import { internalQuery } from '../../_generated/server';
import { loadTrackingConfig } from '../../lib/tracking/views';

/** The whole configuration, secrets included: for server functions only, never for the client. */
export const getConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('appConfig').first();
  },
});

/** The tracking settings in force, for the served script and the beacon route. */
export const getTrackingConfig = internalQuery({
  args: {},
  handler: async (ctx) => await loadTrackingConfig(ctx),
});
