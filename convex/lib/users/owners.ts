import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { isNotDeleted } from '../shared/db';

/** Owners are live employees, deduplicated in order: the first id is the primary owner, the `leadsByOwner` aggregate namespace. */
export async function cleanOwnerIds(ctx: MutationCtx, ids: Id<'users'>[]): Promise<Id<'users'>[]> {
  const out: Id<'users'>[] = [];
  for (const id of new Set(ids)) {
    const user = await ctx.db.get(id);
    if (user?.type !== 'employee' || !isNotDeleted(user)) throw new Error('invalid_owner');
    out.push(id);
  }
  return out;
}
