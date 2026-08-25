import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  isLifecycleRegression,
  lifecycleStageIndex,
  resolveLifecycleConfig,
  type LifecycleChangeSource,
  type LifecycleConfig,
} from '../_lib/validators/lifecycle';

/** The effective lifecycle config of this instance. */
export async function loadLifecycleConfig(ctx: QueryCtx | MutationCtx): Promise<LifecycleConfig> {
  const cfg = await ctx.db.query('appConfig').first();
  return resolveLifecycleConfig(cfg);
}

export type LifecycleTransition =
  | { kind: 'unchanged' }
  | { kind: 'unknown_stage' }
  | { kind: 'regression_blocked' }
  | { kind: 'change'; from: string | undefined; to: string };

/** Decide what setting `lead.lifecycleStage = to` means under `config`. */
export function planLifecycleTransition(
  config: LifecycleConfig,
  lead: Pick<Doc<'leads'>, 'lifecycleStage'>,
  to: string,
): LifecycleTransition {
  if (lifecycleStageIndex(config, to) === -1) return { kind: 'unknown_stage' };
  if (lead.lifecycleStage === to) return { kind: 'unchanged' };
  if (!config.allowRegression && isLifecycleRegression(config, lead.lifecycleStage, to)) {
    return { kind: 'regression_blocked' };
  }
  return { kind: 'change', from: lead.lifecycleStage, to };
}

/**
 * Turn a planned transition into a thrown error for the interactive paths
 * (forms): `unknown_lifecycle_stage` / `lifecycle_regression_blocked`.
 * Bulk paths (CSV, workflows) decide their own outcome instead.
 */
export function assertLifecycleTransition(plan: LifecycleTransition): void {
  if (plan.kind === 'unknown_stage') throw new Error('unknown_lifecycle_stage');
  if (plan.kind === 'regression_blocked') throw new Error('lifecycle_regression_blocked');
}

export type LifecycleChangeMeta = {
  source: LifecycleChangeSource;
  changedBy?: Id<'users'>;
  workflowId?: Id<'workflows'>;
};

/** Append one history row. Callers that patch the lead themselves use this directly. */
export async function insertLifecycleHistory(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  transition: { from: string | undefined; to: string },
  meta: LifecycleChangeMeta,
): Promise<void> {
  await ctx.db.insert('lifecycleStageHistory', {
    leadId,
    from: transition.from,
    to: transition.to,
    source: meta.source,
    changedBy: meta.changedBy,
    workflowId: meta.workflowId,
  });
}

/**
 * Patch the lead's stage and log the transition. `ctx.db` must be the
 * trigger-wrapped one (_lib/functions.ts) so the leadsByLifecycle aggregate
 * follows the patch.
 */
export async function applyLifecycleTransition(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  transition: { from: string | undefined; to: string },
  meta: LifecycleChangeMeta,
): Promise<void> {
  await ctx.db.patch(leadId, { lifecycleStage: transition.to, updatedAt: Date.now() });
  await insertLifecycleHistory(ctx, leadId, transition, meta);
}
