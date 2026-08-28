import { type Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';
import { customPropertiesValidator } from './properties';

export const dealStatusValidator = v.union(v.literal('open'), v.literal('won'), v.literal('lost'));
export type DealStatus = Infer<typeof dealStatusValidator>;

export const pipelineStageValidator = v.object({
  key: v.string(),
  label: v.string(),
  kind: dealStatusValidator,
});
export type PipelineStage = Infer<typeof pipelineStageValidator>;

/** One allowed stage move, by stage keys. */
export const pipelineTransitionValidator = v.object({ from: v.string(), to: v.string() });
export type PipelineTransition = Infer<typeof pipelineTransitionValidator>;

/** Where the editor left the graph: node positions and arrow pulls, in canvas units. */
export const pipelineLayoutValidator = v.object({
  nodes: v.array(v.object({ key: v.string(), x: v.number(), y: v.number() })),
  arrows: v.array(v.object({ from: v.string(), to: v.string(), x: v.number(), y: v.number() })),
});
export type PipelineLayout = Infer<typeof pipelineLayoutValidator>;

export const pipelineValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  name: v.string(),
  stages: v.array(pipelineStageValidator),
  transitions: v.optional(v.array(pipelineTransitionValidator)),
  layout: v.optional(pipelineLayoutValidator),
  // Pipeline new deals land in when none is chosen (form, workflow step).
  isDefault: v.optional(v.boolean()),
});
export type Pipeline = Infer<typeof pipelineValidator>;

export const dealValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  title: v.string(),
  amount: v.optional(v.number()),
  // ISO 4217 code, upper-case. One currency per deal; sums are per currency.
  currency: v.string(),
  pipelineId: v.id('pipelines'),
  stageKey: v.string(),
  // Kind of the current stage — kept in step with `stageKey` by the stage-move
  // helper (lib/deals.ts), the only writer of both.
  status: dealStatusValidator,
  // 'YYYY-MM-DD'.
  expectedCloseDate: v.optional(v.string()),
  // Stamped when the deal enters a won/lost stage, cleared when it reopens.
  closedAt: v.optional(v.number()),
  ownerIds: v.array(v.id('users')),
  leadId: v.optional(v.id('leads')),
  lossReason: v.optional(v.string()),
  // Campaign that originated the deal — the hook for revenue attribution.
  sourceCampaignId: v.optional(v.id('campaigns')),
  customProperties: customPropertiesValidator,
});
export type Deal = Infer<typeof dealValidator>;

export const dealStageChangeSourceValidator = v.union(
  v.literal('create'),
  v.literal('manual'),
  v.literal('workflow'),
);

/** Append-only log of stage moves, one row per change (creation included, `from` unset). */
export const dealStageHistoryValidator = v.object({
  dealId: v.id('deals'),
  pipelineId: v.id('pipelines'),
  from: v.optional(v.string()),
  to: v.string(),
  source: dealStageChangeSourceValidator,
  changedBy: v.optional(v.id('users')),
  workflowId: v.optional(v.id('workflows')),
});
export type DealStageHistory = Infer<typeof dealStageHistoryValidator>;

export const DEFAULT_CURRENCY = 'EUR';
export const MAX_PIPELINE_STAGES = 20;
export const PIPELINE_STAGE_KEY_RE = /^[a-z0-9_]{1,32}$/;

/** The pipeline every instance starts with (ensureDefaultPipeline). */
export const DEFAULT_PIPELINE_STAGES: readonly PipelineStage[] = [
  { key: 'new', label: 'Nouvelle', kind: 'open' },
  { key: 'qualified', label: 'Qualifiée', kind: 'open' },
  { key: 'proposal', label: 'Proposition envoyée', kind: 'open' },
  { key: 'negotiation', label: 'Négociation', kind: 'open' },
  { key: 'won', label: 'Gagnée', kind: 'won' },
  { key: 'lost', label: 'Perdue', kind: 'lost' },
];
export const DEFAULT_PIPELINE_NAME = 'Pipeline commercial';

export function pipelineStage(
  pipeline: Pick<Pipeline, 'stages'>,
  key: string | undefined,
): PipelineStage | undefined {
  return key === undefined ? undefined : pipeline.stages.find((s) => s.key === key);
}

/** The stage new deals land in: the first open stage (else the first stage). */
export function defaultPipelineStage(
  pipeline: Pick<Pipeline, 'stages'>,
): PipelineStage | undefined {
  return pipeline.stages.find((s) => s.kind === 'open') ?? pipeline.stages[0];
}

export function validatePipelineStages(stages: PipelineStage[]): string | null {
  if (stages.length === 0) return 'pipeline_no_stages';
  if (stages.length > MAX_PIPELINE_STAGES) return 'pipeline_too_many_stages';
  const keys = new Set<string>();
  for (const stage of stages) {
    if (!PIPELINE_STAGE_KEY_RE.test(stage.key)) return 'pipeline_invalid_key';
    if (keys.has(stage.key)) return 'pipeline_duplicate_key';
    if (!stage.label.trim()) return 'pipeline_empty_label';
    keys.add(stage.key);
  }
  if (stages.length < 3) return 'pipeline_no_open_stage';
  const open = stages.slice(0, -2);
  const [won, lost] = stages.slice(-2);
  if (open.some((s) => s.kind !== 'open')) return 'pipeline_closed_stage_misplaced';
  if (won.kind !== 'won') return 'pipeline_no_won_stage';
  if (lost.kind !== 'lost') return 'pipeline_no_lost_stage';
  return null;
}

type StageGraph = Pick<Pipeline, 'stages' | 'transitions'>;

const transitionKey = (t: PipelineTransition) => `${t.from}\u0000${t.to}`;

/** The default graph: each stage → the next one and back; the last open stage ↔ won and lost. */
export function defaultTransitions(stages: readonly PipelineStage[]): PipelineTransition[] {
  const open = stages.filter((s) => s.kind === 'open');
  const closed = stages.filter((s) => s.kind !== 'open');
  const out: PipelineTransition[] = [];
  for (let i = 0; i + 1 < open.length; i++) {
    out.push({ from: open[i].key, to: open[i + 1].key });
    out.push({ from: open[i + 1].key, to: open[i].key });
  }
  const last = open[open.length - 1];
  if (last) {
    for (const c of closed) {
      out.push({ from: last.key, to: c.key });
      out.push({ from: c.key, to: last.key });
    }
  }
  return out;
}

/** The arrows in force: the stored list, else the default graph. */
export function effectiveTransitions(pipeline: StageGraph): PipelineTransition[] {
  return pipeline.transitions ?? defaultTransitions(pipeline.stages);
}

/** Whether a deal may move `from` → `to`; staying put is always fine. */
export function isTransitionAllowed(pipeline: StageGraph, from: string, to: string): boolean {
  if (from === to) return true;
  return effectiveTransitions(pipeline).some((t) => t.from === from && t.to === to);
}

/** Stage keys a deal in `from` may move to, in pipeline order. */
export function allowedTargets(pipeline: StageGraph, from: string): string[] {
  return pipeline.stages
    .filter((s) => s.key !== from && isTransitionAllowed(pipeline, from, s.key))
    .map((s) => s.key);
}

/** The complete graph: open → every other stage, closed → every open stage (reopen). */
export function fullTransitions(stages: readonly PipelineStage[]): PipelineTransition[] {
  const out: PipelineTransition[] = [];
  for (const from of stages) {
    for (const to of stages) {
      if (from.key === to.key) continue;
      if (from.kind !== 'open' && to.kind !== 'open') continue;
      out.push({ from: from.key, to: to.key });
    }
  }
  return out;
}

/** A stored layout only for the current stages: unknown nodes and arrows are dropped. */
export function pruneLayout(
  layout: PipelineLayout | undefined,
  stages: readonly PipelineStage[],
): PipelineLayout | undefined {
  if (!layout) return undefined;
  const keys = new Set(stages.map((s) => s.key));
  return {
    nodes: layout.nodes.filter((n) => keys.has(n.key)),
    arrows: layout.arrows.filter((a) => keys.has(a.from) && keys.has(a.to)),
  };
}

/** Drop the arrows whose ends no longer exist (a removed stage takes its arrows along). */
export function pruneTransitions(
  transitions: readonly PipelineTransition[] | undefined,
  stages: readonly PipelineStage[],
): PipelineTransition[] | undefined {
  if (!transitions) return undefined;
  const keys = new Set(stages.map((s) => s.key));
  return transitions.filter((t) => keys.has(t.from) && keys.has(t.to));
}

/** Known keys, no self-loop, no duplicate, closed → open only. Error code or null. */
export function validatePipelineTransitions(
  stages: readonly PipelineStage[],
  transitions: readonly PipelineTransition[] | undefined,
): string | null {
  if (!transitions) return null;
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const seen = new Set<string>();
  for (const t of transitions) {
    const from = byKey.get(t.from);
    const to = byKey.get(t.to);
    if (!from || !to) return 'pipeline_transition_unknown_stage';
    if (t.from === t.to) return 'pipeline_transition_self_loop';
    if (from.kind !== 'open' && to.kind !== 'open') return 'pipeline_transition_from_closed';
    const key = transitionKey(t);
    if (seen.has(key)) return 'pipeline_transition_duplicate';
    seen.add(key);
  }
  return null;
}

function sameTransitions(
  a: readonly PipelineTransition[],
  b: readonly PipelineTransition[],
): boolean {
  const keys = new Set(a.map(transitionKey));
  return keys.size === b.length && b.every((t) => keys.has(transitionKey(t)));
}

/** Whether the list is the complete graph (« Tout autoriser »). */
export function isFullTransitions(
  stages: readonly PipelineStage[],
  transitions: readonly PipelineTransition[] | undefined,
): boolean {
  return transitions !== undefined && sameTransitions(fullTransitions(stages), transitions);
}

/** The default graph is stored as absent; any other list as-is. */
export function normalizeTransitions(
  stages: readonly PipelineStage[],
  transitions: readonly PipelineTransition[] | undefined,
): PipelineTransition[] | undefined {
  if (!transitions) return undefined;
  if (sameTransitions(defaultTransitions(stages), transitions)) return undefined;
  return transitions.map((t) => ({ from: t.from, to: t.to }));
}

export type PipelineGraphIssue =
  /** No path from the first open stage. */
  | { kind: 'unreachable'; stageKey: string }
  /** An open stage from which no won or lost stage can be reached. */
  | { kind: 'dead_end'; stageKey: string };

/** Warnings of a stage graph (the default graph when the list is absent). */
export function analyzePipelineGraph(
  stages: readonly PipelineStage[],
  transitions: readonly PipelineTransition[] | undefined,
): PipelineGraphIssue[] {
  if (!transitions) transitions = defaultTransitions(stages);
  const keys = new Set(stages.map((s) => s.key));
  const kindOf = new Map(stages.map((s) => [s.key, s.kind]));
  const out = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const key of keys) {
    out.set(key, []);
    incoming.set(key, []);
  }
  for (const t of transitions) {
    if (!keys.has(t.from) || !keys.has(t.to) || t.from === t.to) continue;
    out.get(t.from)!.push(t.to);
    // Closed stages are sinks: a reopen arrow is never a way to close.
    if (kindOf.get(t.from) === 'open') incoming.get(t.to)!.push(t.from);
  }
  const flood = (seeds: string[], next: (key: string) => string[]) => {
    const seen = new Set(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
      for (const n of next(queue.shift()!)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  };
  const issues: PipelineGraphIssue[] = [];
  const start = defaultPipelineStage({ stages: [...stages] })?.key;
  const reached = start === undefined ? new Set<string>() : flood([start], (k) => out.get(k) ?? []);
  for (const s of stages) {
    if (!reached.has(s.key)) issues.push({ kind: 'unreachable', stageKey: s.key });
  }
  const closed = stages.filter((s) => s.kind !== 'open').map((s) => s.key);
  const canClose = flood(closed, (k) => incoming.get(k) ?? []);
  for (const s of stages) {
    if (s.kind === 'open' && !canClose.has(s.key)) {
      issues.push({ kind: 'dead_end', stageKey: s.key });
    }
  }
  return issues;
}
