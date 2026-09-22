import { type Infer, v } from 'convex/values';
import type { AppConfig } from './appConfig';

/** How long each kind of data is kept, in days; the nightly purge (features/retention) removes what is older. */
export const RETENTION_BOUNDS = {
  // Soft-deleted leads, companies, deals and activities, restorable until then.
  softDeleteDays: { min: 1, max: 365, default: 30 },
  // Campaign events, workflow step logs, and the tracked links of closed campaigns.
  eventDays: { min: 30, max: 3650, default: 365 },
  // The audit journal.
  auditDays: { min: 90, max: 3650, default: 730 },
} as const;
export type RetentionKey = keyof typeof RETENTION_BOUNDS;
export const RETENTION_KEYS = Object.keys(RETENTION_BOUNDS) as RetentionKey[];

export const retentionConfigValidator = v.object({
  softDeleteDays: v.optional(v.number()),
  eventDays: v.optional(v.number()),
  auditDays: v.optional(v.number()),
});
export type RetentionConfig = Infer<typeof retentionConfigValidator>;
export type RetentionPolicy = Record<RetentionKey, number>;
/** A policy frozen for one purge run, carried from page to page. */
export const retentionPolicyValidator = v.object({
  softDeleteDays: v.number(),
  eventDays: v.number(),
  auditDays: v.number(),
});

/** The policy in force: the configured days, the defaults for the rest. */
export function retentionPolicyOf(config: Pick<AppConfig, 'retention'> | null): RetentionPolicy {
  return Object.fromEntries(
    RETENTION_KEYS.map((key) => [key, config?.retention?.[key] ?? RETENTION_BOUNDS[key].default]),
  ) as RetentionPolicy;
}

export const isWithinRetentionBounds = (key: RetentionKey, days: number): boolean =>
  Number.isInteger(days) && days >= RETENTION_BOUNDS[key].min && days <= RETENTION_BOUNDS[key].max;
