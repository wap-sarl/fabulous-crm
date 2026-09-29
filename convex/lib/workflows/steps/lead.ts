import type { FilterField, LeadStandardField } from '../../../_lib/validators/filters';
import { computeChanges, logAudit } from '../../audit/log';
import {
  applyLifecycleTransition,
  loadLifecycleConfig,
  planLifecycleTransition,
} from '../../leads/lifecycle';
import { buildLeadTargetPatch } from '../../leads/targets';
import { dispatchWorkflowTrigger } from '../dispatch';
import { diffLeadFilterFields } from '../rules';
import { advanceRun, logStep, type NodeOf, type StepContext } from '../runs';

/** The `changedFields` payload for an engine-made property write. */
function targetAsFilterField(
  target: NodeOf<'update_property'>['target'],
): FilterField<LeadStandardField> {
  return target.kind === 'custom'
    ? { kind: 'custom', definitionId: target.propertyDefId }
    : { kind: 'standard', field: target.field };
}

export async function updatePropertyStep(
  { ctx, run, workflow, lead, source }: StepContext,
  node: NodeOf<'update_property'>,
): Promise<void> {
  const patch = await buildLeadTargetPatch(ctx, lead, node.target, node.value);
  if (!patch) {
    await logStep(ctx, run, node, 'skipped', { detail: 'cible invalide ou supprimée' });
  } else {
    const changedFields = diffLeadFilterFields(lead, patch).length
      ? [targetAsFilterField(node.target)]
      : [];
    await ctx.db.patch(lead._id, { ...patch, updatedAt: Date.now() });
    const changes = computeChanges(lead, patch);
    if (changes) {
      await logAudit({
        ctx,
        entityType: 'lead',
        entityId: lead._id,
        action: 'update',
        metadata: { source: 'workflow', workflowId: workflow._id, changes },
      });
    }
    await logStep(ctx, run, node, 'success');
    if (changedFields.length > 0) {
      await dispatchWorkflowTrigger(
        ctx,
        lead._id,
        { type: 'lead_property_changed', changedFields },
        { source },
      );
    }
  }
  await advanceRun(ctx, run, workflow, node.next);
}

export async function setLifecycleStageStep(
  { ctx, run, workflow, lead, source }: StepContext,
  node: NodeOf<'set_lifecycle_stage'>,
): Promise<void> {
  const config = await loadLifecycleConfig(ctx);
  const plan = node.stage
    ? planLifecycleTransition(config, lead, node.stage)
    : ({ kind: 'unknown_stage' } as const);
  switch (plan.kind) {
    case 'unknown_stage':
      await logStep(ctx, run, node, 'skipped', { detail: 'statut introuvable' });
      break;
    case 'regression_blocked':
      await logStep(ctx, run, node, 'skipped', { detail: 'retour en arrière interdit' });
      break;
    case 'unchanged':
      await logStep(ctx, run, node, 'success', { detail: 'déjà à ce statut' });
      break;
    case 'change':
      await applyLifecycleTransition(ctx, lead._id, plan, {
        source: 'workflow',
        workflowId: workflow._id,
      });
      await logStep(ctx, run, node, 'success');
      await dispatchWorkflowTrigger(
        ctx,
        lead._id,
        {
          type: 'lead_property_changed',
          changedFields: [{ kind: 'standard', field: 'lifecycleStage' }],
        },
        { source },
      );
      break;
  }
  await advanceRun(ctx, run, workflow, node.next);
}
