import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { MAX_LEAD_SCORE, MIN_LEAD_SCORE, type ScoringRule } from '../_lib/validators/scoring';
import { evalAdvancedFilter } from '../features/crm/leadMatching';
import { dispatchWorkflowTrigger } from '../features/workflows/triggerDispatch';
import {
  applyLifecycleTransition,
  loadLifecycleConfig,
  planLifecycleTransition,
} from './lifecycle';
import { lifecycleStageIndex, type LifecycleConfig } from '../_lib/validators/lifecycle';
import { DAY_MS } from './timeConstants';

/** The change shape the Triggers wrapper hands to a `leads` trigger. */
interface LeadChange {
  operation: 'insert' | 'update' | 'delete';
  id: Id<'leads'>;
  oldDoc: Doc<'leads'> | null;
  newDoc: Doc<'leads'> | null;
}

/** All scoring rules in display order. Tiny table — read in full. */
export async function loadScoringRules(ctx: MutationCtx): Promise<Doc<'scoringRules'>[]> {
  const rules = await ctx.db.query('scoringRules').collect();
  return rules.sort((a, b) => a.order - b.order);
}

/** The singleton bookkeeping doc, created on first use. */
export async function ensureScoringState(ctx: MutationCtx): Promise<Doc<'scoringState'>> {
  const state = await ctx.db.query('scoringState').first();
  if (state) return state;
  const id = await ctx.db.insert('scoringState', {});
  const created = await ctx.db.get(id);
  if (!created) throw new Error('scoring_state_missing');
  return created;
}

/** Behavioural timestamps a decayed rule can age against. */
const DECAY_DATE_FIELDS = [
  'lastActivityAt',
  'lastEmailOpenAt',
  'lastEmailClickAt',
  'lastFormSubmissionAt',
  'lastPageViewAt',
] as const;

/** Freshest behavioural timestamp among the fields the rule's criteria reference. */
function decayReferenceAt(lead: Doc<'leads'>, rule: ScoringRule): number | undefined {
  let latest: number | undefined;
  for (const group of rule.criteria.groups) {
    for (const r of group.rules) {
      if (r.field.kind !== 'standard') continue;
      const field = r.field.field as (typeof DECAY_DATE_FIELDS)[number];
      if (!DECAY_DATE_FIELDS.includes(field)) continue;
      const at = lead[field];
      if (typeof at === 'number' && (latest === undefined || at > latest)) latest = at;
    }
  }
  return latest;
}

/**
 * Pure score computation: per active matching rule, `points` halved once per
 * `decayHalfLifeDays` elapsed since the rule's decay reference, rounded; the
 * sum is clamped to [MIN_LEAD_SCORE, MAX_LEAD_SCORE]. The breakdown keeps each
 * rule's rounded contribution (pre-clamp) for the lead page.
 */
export function computeLeadScore(
  lead: Doc<'leads'>,
  rules: Doc<'scoringRules'>[],
  now: number,
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let sum = 0;
  for (const rule of rules) {
    if (!rule.active) continue;
    if (!evalAdvancedFilter(lead, rule.criteria, { now })) continue;
    let points = rule.points;
    if (rule.decayHalfLifeDays !== undefined && rule.decayHalfLifeDays > 0) {
      const ref = decayReferenceAt(lead, rule);
      if (ref !== undefined && ref < now) {
        points *= 2 ** (-(now - ref) / (rule.decayHalfLifeDays * DAY_MS));
      }
    }
    const rounded = Math.round(points);
    if (rounded === 0) continue;
    breakdown[rule._id] = rounded;
    sum += rounded;
  }
  return { score: Math.min(MAX_LEAD_SCORE, Math.max(MIN_LEAD_SCORE, sum)), breakdown };
}

function sameBreakdown(a: Record<string, number> | undefined, b: Record<string, number>): boolean {
  const keys = Object.keys(b);
  if (!a) return keys.length === 0;
  return Object.keys(a).length === keys.length && keys.every((k) => a[k] === b[k]);
}

/**
 * Recompute one lead's score and apply every effect of a change: patch the
 * denormalized columns, dispatch `score_threshold_crossed`, and promote the
 * lifecycle stage when the promotion threshold is reached (upward only —
 * scores never demote). `opts` lets batched callers preload the config and
 * active workflows once.
 */
export async function applyLeadScore(
  ctx: MutationCtx,
  lead: Doc<'leads'>,
  rules: Doc<'scoringRules'>[],
  opts?: { lifecycle?: LifecycleConfig; workflows?: Doc<'workflows'>[] },
): Promise<void> {
  const { score, breakdown } = computeLeadScore(lead, rules, Date.now());
  const oldScore = lead.leadScore ?? 0;

  if (score !== oldScore || !sameBreakdown(lead.scoreBreakdown, breakdown)) {
    // Dashboard hook: a leads-by-score-bucket aggregate would follow this patch via a trigger.
    await ctx.db.patch(lead._id, {
      leadScore: score,
      scoreBreakdown: Object.keys(breakdown).length > 0 ? breakdown : undefined,
    });
  }
  if (score !== oldScore) {
    await dispatchWorkflowTrigger(
      ctx,
      lead._id,
      { type: 'score_threshold_crossed', oldScore, newScore: score },
      { workflows: opts?.workflows },
    );
  }

  const config = opts?.lifecycle ?? (await loadLifecycleConfig(ctx));
  const promotion = config.scorePromotion;
  if (!promotion || score < promotion.minScore) return;
  const fromIndex = lifecycleStageIndex(config, lead.lifecycleStage);
  const toIndex = lifecycleStageIndex(config, promotion.stage);
  if (toIndex === -1 || (fromIndex !== -1 && fromIndex >= toIndex)) return;
  const plan = planLifecycleTransition(config, lead, promotion.stage);
  if (plan.kind !== 'change') return;
  await applyLifecycleTransition(ctx, lead._id, plan, { source: 'score' });
}

/**
 * Incremental recomputation, registered as a `leads` trigger
 * (_lib/functions.ts) so EVERY lead write re-scores the lead: field edit,
 * import row, webhook signal stamp. Its own patch re-enters the trigger and
 * converges (same score ⇒ no write). Time drift (decay, relative dates) is the
 * nightly recomputation's job.
 */
export async function syncLeadScore(ctx: MutationCtx, change: LeadChange): Promise<void> {
  if (change.operation === 'delete') return;
  const lead = change.newDoc;
  if (!lead || lead.deletedAt !== undefined) return;
  const rules = await loadScoringRules(ctx);
  // Fast path while scoring is unconfigured: no rules and nothing stored.
  if (rules.length === 0 && lead.leadScore === undefined) return;
  await applyLeadScore(ctx, lead, rules);
}

/**
 * Start (or restart) a full recomputation over all leads: stamp the state,
 * cancel a pending nightly run, and schedule the first page job. A fresh stamp
 * makes the pages of any older run no-ops.
 */
export async function startScoreRecompute(ctx: MutationCtx): Promise<void> {
  const state = await ensureScoringState(ctx);
  const stamp = Date.now();
  if (state.nextRecalcId) {
    // Only cancel a still-pending job — cancelling the nightly job running us would kill the page job below.
    const pending = await ctx.db.system.get(state.nextRecalcId);
    if (pending?.state.kind === 'pending') await ctx.scheduler.cancel(state.nextRecalcId);
  }
  await ctx.db.patch(state._id, { recalc: { stamp, processed: 0 }, nextRecalcId: undefined });
  await ctx.scheduler.runAfter(0, internal.features.scoring.internal.recomputeScoresPage, {
    stamp,
  });
}
