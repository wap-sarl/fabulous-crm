import { type Infer, v } from 'convex/values';
import { z } from 'zod';

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
  // The sites the script runs on: a beacon from elsewhere is refused, a tracked link identifies only when it lands on one.
  allowedOrigins: v.optional(v.array(v.string())),
  // The privacy policy the consent banner links to; named mode needs one.
  privacyUrl: v.optional(v.string()),
});
/** The settings in force, the defaults filled in. */
export type TrackingConfig = Omit<Infer<typeof trackingConfigValidator>, 'allowedOrigins'> & {
  allowedOrigins: string[];
};

export const TRACKING_RETENTION_BOUNDS = { min: 7, max: 395, default: 90 } as const;
export const MAX_ALLOWED_ORIGINS = 20;
export const DEFAULT_TRACKING: TrackingConfig = {
  enabled: false,
  mode: 'anonymous',
  retentionDays: 90,
  allowedOrigins: [],
};

export const trackingRetentionSchema = z
  .number()
  .int()
  .min(TRACKING_RETENTION_BOUNDS.min)
  .max(TRACKING_RETENTION_BOUNDS.max);

const isHttpUrl = (value: string, protocols: string[]): boolean => {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** A site's address as typed, kept as its origin (`https://www.example.fr`). */
export const trackingOriginSchema = z
  .string()
  .trim()
  .refine((value) => isHttpUrl(value, ['https:', 'http:']), 'Adresse de site invalide.')
  .transform((value) => new URL(value).origin);
export const trackingOriginsSchema = z
  .array(trackingOriginSchema)
  .max(MAX_ALLOWED_ORIGINS, `${MAX_ALLOWED_ORIGINS} sites au plus.`)
  .transform((origins) => [...new Set(origins)]);
export const trackingPrivacyUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => isHttpUrl(value, ['https:']), 'Adresse https invalide.');

/** Views waiting on the browser's row for the next write to its contact. */
export const pendingViewsValidator = v.object({
  count: v.number(),
  latest: v.number(),
  paths: v.array(v.string()),
});
export type ViewMarks = Infer<typeof pendingViewsValidator>;

/** A browser, by the id its cookie carries; `leadId` once identified in named mode. */
export const webVisitorValidator = v.object({
  visitorId: v.string(),
  leadId: v.optional(v.id('leads')),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  views: v.number(),
  // Set while a flush to the contact is scheduled.
  pending: v.optional(pendingViewsValidator),
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

/** A view as the route hands it to the mutation: parsed, bounded, on an allowed site. */
export const beaconViewValidator = v.object({
  url: v.string(),
  path: v.string(),
  title: v.optional(v.string()),
  referrer: v.optional(v.string()),
  at: v.number(),
});
export type BeaconView = Infer<typeof beaconViewValidator>;

/** 32 hex chars, as the script mints them. */
export const VISITOR_ID_RE = /^[0-9a-f]{32}$/;
/** The one-time value a tracked link leaves in the landing URL: 32 random bytes, base64url. */
export const LINK_GRANT_RE = /^[A-Za-z0-9_-]{43}$/;
export const LINK_GRANT_PARAM = 'wapl';
/** How long after the click the landing page may redeem it: the time to read a consent banner. */
export const LINK_GRANT_MS = 10 * 60 * 1000;
/** Views a beacon may carry (a SPA batches navigations), and the bounds of what each carries. */
export const MAX_BEACON_EVENTS = 20;
export const MAX_BEACON_BYTES = 64 * 1024;
export const MAX_URL_LENGTH = 2048;
export const MAX_TITLE_LENGTH = 300;
/** Distinct paths kept on the contact for « pages visitées », the most recent last, each cut to a sane length. */
export const VISITED_PAGES_MAX = 50;
export const VISITED_PATH_MAX = 200;
/** Rows the attach, detach and rebuild jobs touch per scheduled step. */
export const ATTACH_BATCH = 200;
/** Contacts a rebuild step refreshes, and the surviving views it reads for each. */
export const REFRESH_LEADS = 20;
export const REFRESH_SCAN = 500;
/** An identified browser's views reach its contact at most this often: one lead write, not one per view. */
export const FLUSH_MS = 60 * 1000;
