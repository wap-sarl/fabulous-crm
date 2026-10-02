import { internal } from '../../../_generated/api';
import { evalAdvancedFilter } from '../../leads/matching';
import { loadLeadFilterExtras } from '../../leads/tableFilters';
import { delayMs } from '../../../_lib/validators/workflowSteps';
import { advanceRun, logStep, type NodeOf, type StepContext } from '../runs';

export async function branchStep(
  { ctx, run, workflow, lead }: StepContext,
  node: NodeOf<'branch'>,
): Promise<void> {
  const extras = await loadLeadFilterExtras(ctx, lead._id, node.condition);
  const result = evalAdvancedFilter(lead, node.condition, extras);
  await logStep(ctx, run, node, 'success', { branchResult: result });
  await advanceRun(ctx, run, workflow, result ? node.nextTrue : node.nextFalse);
}

export async function waitStep(
  { ctx, run, workflow }: StepContext,
  node: NodeOf<'wait'>,
): Promise<void> {
  // A wait with nothing after it is a no-op end of path.
  if (node.next === undefined) {
    await logStep(ctx, run, node, 'success');
    await advanceRun(ctx, run, workflow, undefined);
    return;
  }
  const wakeAt = Date.now() + delayMs(node);
  await logStep(ctx, run, node, 'success', {
    detail: `réveil le ${new Date(wakeAt).toISOString()}`,
  });
  const scheduledFnId = await ctx.scheduler.runAt(
    wakeAt,
    internal.features.workflows.internal.executeStep,
    { runId: run._id, nodeId: node.next },
  );
  await ctx.db.patch(run._id, { currentNodeId: node.next, wakeAt, scheduledFnId });
}
