import { type Infer, v } from 'convex/values';

export const rgpdRequestTypeValidator = v.union(
  // Right of access: the archive was exported.
  v.literal('access'),
  // Right to erasure: the contact and everything it owns are hard-deleted.
  v.literal('erasure'),
  // Right to object to profiling: scoring and behavioural tracking stop for the contact.
  v.literal('objection'),
  v.literal('objection_lifted'),
);
export type RgpdRequestType = Infer<typeof rgpdRequestTypeValidator>;

/** One row per request handled; `leadId` is kept as a string so the row outlives the contact and holds no personal data. */
export const rgpdRequestValidator = v.object({
  type: rgpdRequestTypeValidator,
  leadId: v.string(),
  requestedBy: v.id('users'),
  requestedAt: v.number(),
  completedAt: v.optional(v.number()),
  outcome: v.union(v.literal('done'), v.literal('in_progress')),
  // Counts of what an erasure removed, whether an export was cut short.
  detail: v.optional(v.any()),
});
export type RgpdRequest = Infer<typeof rgpdRequestValidator>;

/** Rows read per table for an export; a table with more is reported as cut. */
export const EXPORT_ROW_CAP = 2000;
