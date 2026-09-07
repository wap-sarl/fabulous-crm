import { nullable } from 'convex-helpers/validators';
import { type Infer, v } from 'convex/values';
import { EE_FEATURES } from '../../../ee/contract';

export const PLANS = ['starter', 'pro', 'enterprise'] as const;
export const planValidator = v.union(...PLANS.map((p) => v.literal(p)));
export type Plan = Infer<typeof planValidator>;

export const eeFeatureValidator = v.union(...EE_FEATURES.map((f) => v.literal(f)));

/** Payload of a signed entitlements token; `null` limits mean unlimited. */
export const entitlementsPayloadValidator = v.object({
  tenant: v.string(),
  plan: planValidator,
  seats: nullable(v.number()),
  workflowRunsPerMonth: nullable(v.number()),
  apiCallsPerMonth: nullable(v.number()),
  retentionDays: v.object({ audit: nullable(v.number()), events: nullable(v.number()) }),
  features: v.array(eeFeatureValidator),
  iat: v.number(),
  exp: v.number(),
});
export type EntitlementsPayload = Infer<typeof entitlementsPayloadValidator>;

export const QUOTA_KINDS = ['workflowRuns', 'apiCalls'] as const;
export type QuotaKind = (typeof QUOTA_KINDS)[number];

/** One row per (kind, month, subject); `subject` is '' or the API key id so keys do not contend on one row. */
export const usageCounterValidator = v.object({
  kind: v.union(...QUOTA_KINDS.map((k) => v.literal(k))),
  month: v.string(),
  subject: v.string(),
  count: v.number(),
});
