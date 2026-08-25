import { type Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';
import { leadPropertyValueValidator } from './leadProperties';

export const dealStatusValidator = v.union(v.literal('open'), v.literal('won'), v.literal('lost'));
export type DealStatus = Infer<typeof dealStatusValidator>;

export const pipelineStageValidator = v.object({
  key: v.string(),
  label: v.string(),
  kind: dealStatusValidator,
});
export type PipelineStage = Infer<typeof pipelineStageValidator>;

export const pipelineValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  name: v.string(),
  stages: v.array(pipelineStageValidator),
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
  ownerId: v.optional(v.id('users')),
  leadId: v.optional(v.id('leads')),
  lossReason: v.optional(v.string()),
  // Campaign that originated the deal — the hook for revenue attribution.
  sourceCampaignId: v.optional(v.id('campaigns')),
  customProperties: v.optional(v.record(v.string(), leadPropertyValueValidator)),
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
