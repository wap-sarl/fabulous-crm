import { v } from 'convex/values';
import { docOf } from '../../lib/shared/docs';
import { trackingModeValidator } from '../../_lib/validators/tracking';
import { internalQuery } from '../../_generated/server';
import { loadTrackingConfig } from '../../lib/tracking/config';

/** The whole configuration, secrets included: for server functions only, never for the client. */
export const getConfig = internalQuery({
  args: {},
  returns: v.union(docOf('appConfig'), v.null()),
  handler: async (ctx) => {
    return await ctx.db.query('appConfig').first();
  },
});

/** The tracking settings in force, for the served script and the beacon route. */
export const getTrackingConfig = internalQuery({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    retentionDays: v.number(),
    mode: trackingModeValidator,
    privacyUrl: v.optional(v.string()),
    ceilingHitAt: v.optional(v.number()),
    allowedOrigins: v.array(v.string()),
  }),
  handler: async (ctx) => await loadTrackingConfig(ctx),
});
