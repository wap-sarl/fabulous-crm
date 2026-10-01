import type { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { DEFAULT_MAX_DYNAMIC_LISTS } from '../../_lib/validators/leadLists';
import type { LeadAdvancedFilter } from '../../_lib/validators/filters';
import { evalAdvancedFilter } from '../leads/matching';
import { dispatchWorkflowTrigger } from '../workflows/dispatch';
import { deleteListMember, insertListMember } from './members';
import type { LeadChange } from '../leads/change';

/** A dynamic list always carries criteria (enforced at creation/update). */
export type DynamicList = Doc<'leadLists'> & { criteria: LeadAdvancedFilter };

/** All dynamic lists. Tiny table (capped by maxDynamicLists) — read in full. */
export async function loadDynamicLists(ctx: MutationCtx): Promise<DynamicList[]> {
  const lists = await ctx.db.query('leadLists').collect();
  return lists.filter((l): l is DynamicList => l.kind === 'dynamic' && l.criteria !== undefined);
}

/** The cap and how much of it is used; the cap is the deployment's, so the count takes the lists the caller cannot see. */
export async function dynamicListLimits(ctx: {
  unscopedDb: QueryCtx['db'];
}): Promise<{ maxDynamicLists: number; dynamicCount: number }> {
  const lists = await ctx.unscopedDb.query('leadLists').collect();
  const cfg = await ctx.unscopedDb.query('appConfig').first();
  return {
    maxDynamicLists: cfg?.lists?.maxDynamicLists ?? DEFAULT_MAX_DYNAMIC_LISTS,
    dynamicCount: lists.filter((l) => l.kind === 'dynamic').length,
  };
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
