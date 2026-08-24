import { TableAggregate } from '@convex-dev/aggregate';
import type { WithoutSystemFields } from 'convex/server';
import { components } from '../_generated/api';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Member count per list, namespaced by `listId` with a null sort key: pure
 * count semantics, no ordering — `count(ctx, { namespace: listId, bounds: {} })`
 * is O(log n) where a junction scan is O(leads × lists).
 */
export const leadListMemberCounts = new TableAggregate<{
  Namespace: Id<'leadLists'>;
  Key: null;
  DataModel: DataModel;
  TableName: 'leadListMembers';
}>(components.leadListMemberCounts, {
  namespace: (doc) => doc.listId,
  sortKey: () => null,
});

/** Insert a junction row and record it in the count aggregate. */
export async function insertListMember(
  ctx: MutationCtx,
  fields: WithoutSystemFields<Doc<'leadListMembers'>>,
): Promise<Id<'leadListMembers'>> {
  const memberId = await ctx.db.insert('leadListMembers', fields);
  const member = await ctx.db.get(memberId);
  // `get` right after `insert` cannot miss; the guard is for the type only.
  if (member) await leadListMemberCounts.insert(ctx, member);
  return memberId;
}

/** Delete a junction row and remove it from the count aggregate. */
export async function deleteListMember(
  ctx: MutationCtx,
  member: Doc<'leadListMembers'>,
): Promise<void> {
  await ctx.db.delete(member._id);
  await leadListMemberCounts.delete(ctx, member);
}
