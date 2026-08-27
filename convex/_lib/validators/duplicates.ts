import { type Infer, v } from 'convex/values';

export const leadDedupeValidator = v.object({
  // E.164 phone (`+33612345678`), or the bare digits when unparsable.
  phone: v.optional(v.string()),
  // `<last>|<first>`, accent-free, lowercase, no separators.
  name: v.string(),
  // First three letters of the normalized last name: the blocking key that
  // bounds the candidate set for name similarity.
  block: v.optional(v.string()),
  // Postal code, uppercase alphanumerics.
  postal: v.optional(v.string()),
});

/** Why two leads look like the same person. */
export const duplicateReasonValidator = v.union(
  v.literal('email'),
  v.literal('phone'),
  v.literal('name_postal'),
  v.literal('same_name'),
  v.literal('similar_name'),
);

export const leadDuplicateValidator = v.object({
  leadAId: v.id('leads'),
  leadBId: v.id('leads'),
  reasons: v.array(duplicateReasonValidator),
  // Sum of the reason weights — orders the list, strongest first.
  score: v.number(),
  status: v.union(v.literal('open'), v.literal('ignored')),
  scanId: v.id('duplicateScans'),
  updatedAt: v.number(),
});

export const duplicateScanValidator = v.object({
  status: v.union(v.literal('running'), v.literal('done')),
  cursor: v.optional(v.string()),
  scanned: v.number(),
  found: v.number(),
  startedBy: v.id('users'),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
});

export type LeadDedupe = Infer<typeof leadDedupeValidator>;
export type DuplicateReason = Infer<typeof duplicateReasonValidator>;
export type LeadDuplicate = Infer<typeof leadDuplicateValidator>;
export type DuplicateScan = Infer<typeof duplicateScanValidator>;
