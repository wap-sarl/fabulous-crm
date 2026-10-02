import { v } from 'convex/values';
import { trackingModeValidator } from '../../_lib/validators/tracking';
import type { Id } from '../../_generated/dataModel';
import { settingsQuery } from '../../_lib/auth';
import { loadTrackingConfig } from '../../lib/tracking/config';

const COUNT_CAP = 1000;

/** The tracking settings in force, for the settings page. */
export const getTrackingSettings = settingsQuery({
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

/** The browsers seen and those tied to a contact, bounded; the page asks once, a subscription would rerun on every new browser. */
export const getTrackingCounts = settingsQuery({
  args: {},
  returns: v.object({
    visitors: v.number(),
    visitorsCapped: v.boolean(),
    identified: v.number(),
    identifiedCapped: v.boolean(),
  }),
  handler: async (ctx) => {
    const visitors = await ctx.db.query('webVisitors').take(COUNT_CAP + 1);
    const identified = await ctx.db
      .query('webVisitors')
      .withIndex('by_lead', (q) => q.gt('leadId', '' as Id<'leads'>))
      .take(COUNT_CAP + 1);
    return {
      visitors: Math.min(visitors.length, COUNT_CAP),
      visitorsCapped: visitors.length > COUNT_CAP,
      identified: Math.min(identified.length, COUNT_CAP),
      identifiedCapped: identified.length > COUNT_CAP,
    };
  },
});
