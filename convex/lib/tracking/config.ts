import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { AppConfig } from '../../_lib/validators/appConfig';
import { DEFAULT_TRACKING, type TrackingConfig } from '../../_lib/validators/tracking';

/** The tracking settings in force: the stored ones, the defaults for the rest. */
export function trackingConfigOf(config: Pick<AppConfig, 'tracking'> | null): TrackingConfig {
  return { ...DEFAULT_TRACKING, ...(config?.tracking ?? {}) };
}

export async function loadTrackingConfig(ctx: QueryCtx | MutationCtx): Promise<TrackingConfig> {
  return trackingConfigOf(await ctx.db.query('appConfig').first());
}

/** Named tracking at work: the switch on, the mode named. */
export const namedTracking = (config: TrackingConfig): boolean =>
  config.enabled && config.mode === 'named';

/** Whether a URL lands on one of the sites the script runs on. */
export function onAllowedSite(config: TrackingConfig, url: string | undefined): boolean {
  if (!url) return false;
  try {
    return config.allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}
