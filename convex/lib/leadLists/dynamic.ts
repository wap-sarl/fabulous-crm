import type { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import type { LeadAdvancedFilter } from '../../_lib/validators/filters';
import { evalAdvancedFilter } from '../leads/matching';
import { dispatchWorkflowTrigger } from '../../features/workflows/triggerDispatch';
import { deleteListMember, insertListMember } from './members';

/** A dynamic list always carries criteria (enforced at creation/update). */
export type DynamicList = Doc<'leadLists'> & { criteria: LeadAdvancedFilter };

/** The change shape the Triggers wrapper hands to a `leads` trigger. */
interface LeadChange {
  operation: 'insert' | 'update' | 'delete';
  id: Id<'leads'>;
  oldDoc: Doc<'leads'> | null;
  newDoc: Doc<'leads'> | null;
}

/** All dynamic lists. Tiny table (capped by maxDynamicLists) — read in full. */
export async function loadDynamicLists(ctx: MutationCtx): Promise<DynamicList[]> {
  const lists = await ctx.db.query('leadLists').collect();
  return lists.filter((l): l is DynamicList => l.kind === 'dynamic' && l.criteria !== undefined);
}

/** Whether a lead belongs in a dynamic list right now. Deleted leads never do. */
function matchesDynamicList(lead: Doc<'leads'> | null, list: DynamicList): boolean {
  return !!lead && lead.deletedAt === undefined && evalAdvancedFilter(lead, list.criteria);
}

/** Goes through the aggregate-aware helpers and fires `list_membership_changed` only on an actual change; `workflows` lets a batched caller load them once. */
export async function syncDynamicMembership(
  ctx: MutationCtx,
  listId: Id<'leadLists'>,
  leadId: Id<'leads'>,
  should: boolean,
  workflows?: Doc<'workflows'>[],
): Promise<'added' | 'removed' | null> {
  const member = await ctx.db
    .query('leadListMembers')
    .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', leadId))
    .first();
  if (should && !member) {
    await insertListMember(ctx, { listId, leadId });
    await dispatchWorkflowTrigger(
      ctx,
      leadId,
      { type: 'list_membership_changed', change: 'added', listId },
      { workflows },
    );
    return 'added';
  }
  if (!should && member) {
    await deleteListMember(ctx, member);
    await dispatchWorkflowTrigger(
      ctx,
      leadId,
      { type: 'list_membership_changed', change: 'removed', listId },
      { workflows },
    );
    return 'removed';
  }
  return null;
}

/** A `leads` trigger, so every lead write goes through it; memberships are read only when a verdict flips, and drift (relative dates) is the full recalc's job. */
export async function syncLeadDynamicLists(ctx: MutationCtx, change: LeadChange): Promise<void> {
  // Leads are soft-deleted (an update); hard deletes don't manage memberships here.
  if (change.operation === 'delete') return;
  const lists = await loadDynamicLists(ctx);
  for (const list of lists) {
    const before = matchesDynamicList(change.oldDoc, list);
    const after = matchesDynamicList(change.newDoc, list);
    if (change.operation === 'update' && before === after) continue;
    if (change.operation === 'insert' && !after) continue;
    await syncDynamicMembership(ctx, list._id, change.id, after);
  }
}

/** Starts or restarts the full recalculation of one list: the fresh stamp makes the pages of any older run no-ops. */
export async function startDynamicListRecalc(
  ctx: MutationCtx,
  list: Doc<'leadLists'>,
): Promise<void> {
  const stamp = Date.now();
  if (list.nextRecalcId) {
    // Only cancel a still-pending job — cancelling the drift job running us would kill the page job below.
    const pending = await ctx.db.system.get(list.nextRecalcId);
    if (pending?.state.kind === 'pending') await ctx.scheduler.cancel(list.nextRecalcId);
  }
  await ctx.db.patch(list._id, { recalc: { stamp, processed: 0 }, nextRecalcId: undefined });
  await ctx.scheduler.runAfter(0, internal.features.leadLists.internal.recalcDynamicListPage, {
    listId: list._id,
    stamp,
  });
}
