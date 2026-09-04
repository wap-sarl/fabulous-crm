import { type Infer, v } from 'convex/values';

/** Stage keys: short, lowercase, URL/CSV-safe. */
export const LIFECYCLE_STAGE_KEY_RE = /^[a-z0-9_]{1,32}$/;
export const MAX_LIFECYCLE_STAGES = 20;

export const lifecycleStageValidator = v.object({
  key: v.string(),
  label: v.string(),
});

export const lifecycleConfigValidator = v.object({
  stages: v.array(lifecycleStageValidator),
  // Stage stamped on leads created without an explicit one (form, import).
  defaultStage: v.string(),
  allowRegression: v.boolean(),
  scorePromotion: v.optional(v.object({ stage: v.string(), minScore: v.number() })),
});

export type LifecycleStage = Infer<typeof lifecycleStageValidator>;
export type LifecycleConfig = Infer<typeof lifecycleConfigValidator>;

export const DEFAULT_LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  { key: 'subscriber', label: 'Abonné' },
  { key: 'lead', label: 'Lead' },
  { key: 'mql', label: 'MQL' },
  { key: 'sql', label: 'SQL' },
  { key: 'opportunity', label: 'Opportunité' },
  { key: 'customer', label: 'Client' },
  { key: 'evangelist', label: 'Ambassadeur' },
  { key: 'other', label: 'Autre' },
];

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  stages: [...DEFAULT_LIFECYCLE_STAGES],
  defaultStage: 'lead',
  allowRegression: false,
};

export function resolveLifecycleConfig(
  cfg: { lifecycle?: LifecycleConfig | null } | null | undefined,
): LifecycleConfig {
  return cfg?.lifecycle ?? DEFAULT_LIFECYCLE_CONFIG;
}

/** Funnel position of a stage key, or -1 when it is not (or no longer) configured. */
export function lifecycleStageIndex(config: LifecycleConfig, key: string | undefined): number {
  if (key === undefined) return -1;
  return config.stages.findIndex((s) => s.key === key);
}

/**
 * Whether moving `from` → `to` walks back down the funnel. Leaving an unset or
 * unknown (removed) stage is never a regression, so a lead is never stuck.
 */
export function isLifecycleRegression(
  config: LifecycleConfig,
  from: string | undefined,
  to: string,
): boolean {
  const fromIndex = lifecycleStageIndex(config, from);
  const toIndex = lifecycleStageIndex(config, to);
  return fromIndex !== -1 && toIndex !== -1 && toIndex < fromIndex;
}

/** French label of a stage key; falls back to the raw key for removed stages. */
export function lifecycleStageLabel(config: LifecycleConfig, key: string | undefined): string {
  if (key === undefined) return '—';
  return config.stages.find((s) => s.key === key)?.label ?? key;
}

/** Who or what moved a lead between stages. */
export const lifecycleChangeSourceValidator = v.union(
  v.literal('manual'),
  v.literal('import'),
  v.literal('workflow'),
  // Historical rows only (the one-off import of pre-lifecycle leads).
  v.literal('migration'),
  // A won deal turned the lead into a customer.
  v.literal('deal'),
  // The lead crossed the score-promotion threshold (lifecycle settings).
  v.literal('score'),
  v.literal('api'),
);

/**
 * Append-only log of lifecycle transitions, one row per change (the initial
 * stage included, with `from` unset). `_creationTime` is the transition time,
 * so stage-to-stage durations are the difference between consecutive rows of
 * a lead. Never patched or deleted.
 */
export const lifecycleStageHistoryValidator = v.object({
  leadId: v.id('leads'),
  from: v.optional(v.string()),
  to: v.string(),
  source: lifecycleChangeSourceValidator,
  // The employee behind a manual/import change; absent for workflow/migration.
  changedBy: v.optional(v.id('users')),
  // The workflow whose step made the change (source 'workflow').
  workflowId: v.optional(v.id('workflows')),
});

export type LifecycleChangeSource = Infer<typeof lifecycleChangeSourceValidator>;
export type LifecycleStageHistory = Infer<typeof lifecycleStageHistoryValidator>;
