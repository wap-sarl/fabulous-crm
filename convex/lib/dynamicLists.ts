import type { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import type { LeadAdvancedFilter } from '../_lib/validators/filters';
import { evalAdvancedFilter } from '../features/crm/leadMatching';
import { dispatchWorkflowTrigger } from '../features/workflows/triggerDispatch';
import { deleteListMember, insertListMember } from './leadListMembers';

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
export function matchesDynamicList(lead: Doc<'leads'> | null, list: DynamicList): boolean {
  return !!lead && lead.deletedAt === undefined && evalAdvancedFilter(lead, list.criteria);
}

/**
 * Make the junction row agree with `should`, through the aggregate-aware
 * helpers, and fire `list_membership_changed` on an actual change. `workflows`
 * lets batched callers preload the active workflows once.
 */
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

/**
 * Incremental evaluation, registered as a `leads` trigger (_lib/functions.ts)
 * so EVERY lead write goes through it: create, update, import row, signal
 * stamping, consent update. Membership reads happen only when a list's verdict
 * flips on this write — the steady state costs one pure eval per dynamic list.
 * Drift (relative-date criteria, out-of-band rows) is the full recalc's job.
 */
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

/**
 * Start (or restart) a full recalculation of one dynamic list: stamp it,
 * cancel any pending time-drift run, and schedule the first page job. A fresh
 * stamp makes the pages of any older run no-ops.
 */
export async function startDynamicListRecalc(
  ctx: MutationCtx,
  list: Doc<'leadLists'>,
): Promise<void> {
  const stamp = Date.now();
  if (list.nextRecalcId) await ctx.scheduler.cancel(list.nextRecalcId);
  await ctx.db.patch(list._id, { recalc: { stamp, processed: 0 }, nextRecalcId: undefined });
  await ctx.scheduler.runAfter(0, internal.features.crm.internal.recalcDynamicListPage, {
    listId: list._id,
    stamp,
  });
}
