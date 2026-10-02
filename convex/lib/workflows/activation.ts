import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { loadLifecycleConfig } from '../leads/lifecycle';
import { loadPropertyDefinitions } from '../properties/definitions';
import { isNotDeleted } from '../shared/db';
import { validateWorkflowGraph } from './rules';

/** Why a workflow cannot be activated as it is, in the words shown to the person, or `null`; `ctx.db` decides which lists and pipelines exist for the caller. */
export async function activationIssue(
  ctx: QueryCtx | MutationCtx,
  workflow: Doc<'workflows'>,
): Promise<string | null> {
  const defs = await loadPropertyDefinitions(ctx, 'lead');
  const defsById = new Map(defs.map((d) => [d._id as string, d]));
  const lists = await ctx.db.query('leadLists').collect();
  const listIds = new Set<string>(lists.map((l) => l._id as string));
  const lifecycle = await loadLifecycleConfig(ctx);
  const stageKeys = new Set(lifecycle.stages.map((s) => s.key));
  const pipelines = new Map(
    (await ctx.db.query('pipelines').collect())
      .filter(isNotDeleted)
      .map((p) => [p._id as string, p]),
  );
  return validateWorkflowGraph(
    workflow.nodes,
    workflow.startNodeId,
    defsById,
    listIds,
    stageKeys,
    pipelines,
    workflow.trigger,
  );
}
