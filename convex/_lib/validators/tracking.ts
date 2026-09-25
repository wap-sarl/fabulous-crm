import { type Infer, v } from 'convex/values';

/*
 * Web tracking: a script the deployment serves, a first-party visitor cookie on the customer's site, page-view
 * beacons. Named tracking (views attached to a contact) needs a legal basis and the person's consent, so the mode
 * is a setting and the default is anonymous.
 */

export const trackingModeValidator = v.union(v.literal('anonymous'), v.literal('named'));
export type TrackingMode = Infer<typeof trackingModeValidator>;

export const trackingConfigValidator = v.object({
  enabled: v.boolean(),
  mode: trackingModeValidator,
  // Days a page view is kept; the nightly purge removes what is older.
  retentionDays: v.number(),
});
export type TrackingConfig = Infer<typeof trackingConfigValidator>;

export const TRACKING_RETENTION_BOUNDS = { min: 7, max: 395, default: 90 } as const;
export const DEFAULT_TRACKING: TrackingConfig = {
  enabled: false,
  mode: 'anonymous',
  retentionDays: 90,
};

/** A browser, by the id its cookie carries; `leadId` once identified in named mode. */
export const webVisitorValidator = v.object({
  visitorId: v.string(),
  leadId: v.optional(v.id('leads')),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  views: v.number(),
});
export type WebVisitor = Infer<typeof webVisitorValidator>;

export const pageViewValidator = v.object({
  visitorId: v.string(),
  // Set at ingestion for an identified visitor, or by the attach job for the views that came before.
  leadId: v.optional(v.id('leads')),
  url: v.string(),
  // The URL's path, what filters and scoring match on.
  path: v.string(),
  title: v.optional(v.string()),
  referrer: v.optional(v.string()),
  at: v.number(),
});
export type PageView = Infer<typeof pageViewValidator>;

/** 32 hex chars, as the script mints them. */
export const VISITOR_ID_RE = /^[0-9a-f]{32}$/;
/** Views a beacon may carry (a SPA batches navigations), and the bounds of what each carries. */
export const MAX_BEACON_EVENTS = 20;
export const MAX_URL_LENGTH = 2048;
export const MAX_TITLE_LENGTH = 300;
/** Distinct paths kept on the contact for « a visité une page », the most recent last. */
export const VISITED_PAGES_MAX = 50;
/** Views the attach job moves per scheduled step. */
export const ATTACH_BATCH = 200;
