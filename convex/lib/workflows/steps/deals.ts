import { refusalText } from '../../../_lib/refusal';
import { createDealRecord, latestOpenDealOfLead, moveDealToStage } from '../../deals/records';
import { renderPlaceholders } from '../../email/brevo';
import { leadParams } from '../params';
import { advanceRun, logStep, type NodeOf, type StepContext } from '../runs';

export async function createDealStep(
  { ctx, run, workflow, lead, source }: StepContext,
  node: NodeOf<'create_deal'>,
): Promise<void> {
  const params = await leadParams(ctx, lead);
  const title = renderPlaceholders(node.title, params, false).trim();
  try {
    const dealId = await createDealRecord(
      ctx,
      {
        title: title || node.title,
        amount: node.amount,
        currency: node.currency,
        pipelineId: node.pipelineId,
        stageKey: node.stageKey,
        ownerIds: lead.ownerIds,
        leadId: lead._id,
      },
      { source: 'workflow', workflowId: workflow._id, runSource: source },
    );
    await logStep(ctx, run, node, 'success', { detail: `transaction ${dealId}` });
  } catch (e) {
    await logStep(ctx, run, node, 'skipped', {
      detail: refusalText(e, 'pipeline introuvable'),
    });
  }
  await advanceRun(ctx, run, workflow, node.next);
}

export async function updateDealStageStep(
  { ctx, run, workflow, lead, source }: StepContext,
  node: NodeOf<'update_deal_stage'>,
): Promise<void> {
  const deal = await latestOpenDealOfLead(ctx, lead._id, node.pipelineId);
  if (!deal || !node.stageKey) {
    await logStep(ctx, run, node, 'skipped', { detail: 'aucune transaction ouverte' });
  } else {
    const move = await moveDealToStage(
      ctx,
      deal,
      node.stageKey,
      { source: 'workflow', workflowId: workflow._id, runSource: source },
      { tags: node.tags },
    );
    if (move.kind === 'unknown_stage') {
      await logStep(ctx, run, node, 'skipped', { detail: 'stade introuvable' });
    } else if (move.kind === 'unknown_tag') {
      await logStep(ctx, run, node, 'skipped', { detail: 'étiquette introuvable' });
    } else if (move.kind === 'tag_required') {
      await logStep(ctx, run, node, 'skipped', { detail: 'étiquette requise' });
    } else if (move.kind === 'forbidden') {
      await logStep(ctx, run, node, 'skipped', {
        detail: `transition interdite depuis « ${deal.stageKey} »`,
      });
    } else if (move.kind === 'unchanged') {
      await logStep(ctx, run, node, 'success', { detail: 'déjà à ce stade' });
    } else {
      await logStep(ctx, run, node, 'success', { detail: `transaction ${deal._id}` });
    }
  }
  await advanceRun(ctx, run, workflow, node.next);
}
