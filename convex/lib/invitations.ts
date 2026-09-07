import type { MutationCtx, QueryCtx } from '../_generated/server';

/** Open invitations, the number an overlay may count as reserved seats. */
export async function countPendingInvitations(ctx: QueryCtx | MutationCtx): Promise<number> {
  const rows = await ctx.db
    .query('invitations')
    .withIndex('by_status', (q) => q.eq('status', 'pending'))
    .collect();
  return rows.length;
}
