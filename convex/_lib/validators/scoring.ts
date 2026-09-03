import { type Infer, v } from 'convex/values';
import {
  criteriaUsesRelativeDates,
  isActiveRule,
  type LeadAdvancedFilter,
  leadAdvancedFilterValidator,
} from './filters';
import { logsValidator } from './shared';

/** Scores are clamped to this range; thresholds live inside it too. */
export const MIN_LEAD_SCORE = 0;
export const MAX_LEAD_SCORE = 100;
export const MAX_DECAY_HALF_LIFE_DAYS = 365;

/**
 * One scoring rule: leads matching `criteria` earn `points` (negative allowed).
 * `decayHalfLifeDays` halves the earned points every N days measured from the
 * freshest behavioural timestamp the criteria reference (open, click, visit…);
 * rules whose criteria carry no such field keep their full points. `order` is
 * the display order on the settings page.
 */
export const scoringRuleValidator = v.object({
  ...logsValidator.fields,
  name: v.string(),
  description: v.optional(v.string()),
  criteria: leadAdvancedFilterValidator,
  points: v.number(),
  active: v.boolean(),
  decayHalfLifeDays: v.optional(v.number()),
  order: v.number(),
});

export type ScoringRule = Infer<typeof scoringRuleValidator>;

/**
 * Singleton bookkeeping doc for the scoring engine (created on first use).
 * `recalc` mirrors the dynamic-list pattern: `stamp` invalidates superseded
 * page jobs, `processed` feeds the UI progress. `nextRecalcId` is the pending
 * nightly decay recomputation. `simulation` is the latest what-if count.
 */
export const scoringStateValidator = v.object({
  recalc: v.optional(v.object({ stamp: v.number(), processed: v.number() })),
  lastRecalcAt: v.optional(v.number()),
  nextRecalcId: v.optional(v.id('_scheduled_functions')),
  simulation: v.optional(
    v.object({
      threshold: v.number(),
      stamp: v.number(),
      processed: v.number(),
      matched: v.number(),
      finishedAt: v.optional(v.number()),
    }),
  ),
});

export type ScoringState = Infer<typeof scoringStateValidator>;

/**
 * Criteria must hold at least one active rule and may not reference `listIds`
 * (membership reads on every lead write, cascade risk) or `leadScore` (a score
 * feeding itself never converges). Returns the error code or null.
 */
export function validateScoringCriteria(criteria: LeadAdvancedFilter | undefined): string | null {
  const rules = criteria?.groups.flatMap((g) => g.rules) ?? [];
  if (!rules.some(isActiveRule)) return 'scoring_criteria_required';
  const forbidden = rules.some(
    (r) =>
      r.field.kind === 'standard' && (r.field.field === 'listIds' || r.field.field === 'leadScore'),
  );
  return forbidden ? 'scoring_criteria_forbidden_field' : null;
}

/** Scores can drift with time alone: decayed points, or relative-date criteria. */
export function scoringNeedsNightlyRecompute(rules: ScoringRule[]): boolean {
  return rules.some(
    (r) => r.active && (r.decayHalfLifeDays !== undefined || criteriaUsesRelativeDates(r.criteria)),
  );
}
