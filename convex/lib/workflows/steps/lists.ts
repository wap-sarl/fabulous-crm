import type { Id } from '../../../_generated/dataModel';
import { deleteListMember, insertListMember } from '../../leadLists/members';
import { dispatchWorkflowTrigger } from '../dispatch';
import { advanceRun, logStep, type NodeOf, type StepContext } from '../runs';

/** The list a step can change; one that is missing or dynamic is logged as a skip and gives null. */
async function staticListOf(
  { ctx, run }: StepContext,
  node: NodeOf<'add_to_list' | 'remove_from_list'>,
): Promise<Id<'leadLists'> | null> {
  const listId = node.listId;
  const list = listId ? await ctx.db.get(listId) : null;
  if (!listId || !list) {
    await logStep(ctx, run, node, 'skipped', { detail: 'liste introuvable' });
    return null;
  }
  if (list.kind === 'dynamic') {
    await logStep(ctx, run, node, 'skipped', {
      detail: 'liste dynamique (membres calculés)',
    });
    return null;
  }
  return listId;
}

const memberOf = ({ ctx, lead }: StepContext, listId: Id<'leadLists'>) =>
  ctx.db
    .query('leadListMembers')
    .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', lead._id))
    .first();

export async function addToListStep(step: StepContext, node: NodeOf<'add_to_list'>): Promise<void> {
  const { ctx, run, workflow, lead, source } = step;
  const listId = await staticListOf(step, node);
  if (listId) {
    const existing = await memberOf(step, listId);
    if (existing) {
      await logStep(ctx, run, node, 'success', { detail: 'déjà dans la liste' });
    } else {
      // Junction rows require an author; attribute to the workflow's owner.
      const addedBy = workflow.createdBy ?? workflow.updatedBy;
      if (!addedBy) {
        await logStep(ctx, run, node, 'skipped', { detail: 'workflow sans auteur' });
      } else {
        await insertListMember(ctx, { listId, leadId: lead._id, addedBy });
        await logStep(ctx, run, node, 'success');
        await dispatchWorkflowTrigger(
          ctx,
          lead._id,
          { type: 'list_membership_changed', change: 'added', listId },
          { source },
        );
      }
    }
  }
  await advanceRun(ctx, run, workflow, node.next);
}

export async function removeFromListStep(
  step: StepContext,
  node: NodeOf<'remove_from_list'>,
): Promise<void> {
  const { ctx, run, workflow, lead, source } = step;
  const listId = await staticListOf(step, node);
  if (listId) {
    const member = await memberOf(step, listId);
    if (!member) {
      await logStep(ctx, run, node, 'success', { detail: 'déjà hors de la liste' });
    } else {
      await deleteListMember(ctx, member);
      await logStep(ctx, run, node, 'success');
      await dispatchWorkflowTrigger(
        ctx,
        lead._id,
        { type: 'list_membership_changed', change: 'removed', listId },
        { source },
      );
    }
  }
  await advanceRun(ctx, run, workflow, node.next);
}
