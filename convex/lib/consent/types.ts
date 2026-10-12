import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { DEFAULT_SUBSCRIPTION_TYPES } from '../../_lib/validators/subscriptions';
import { createAuditFields } from '../audit/log';

/** Every type, in the order the settings show them. */
export async function loadSubscriptionTypes(
  ctx: Pick<QueryCtx, 'db'>,
): Promise<Doc<'subscriptionTypes'>[]> {
  const types = await ctx.db.query('subscriptionTypes').collect();
  return types.sort((a, b) => a.order - b.order);
}

/** The types a contact can be in on today: the active ones. */
export async function loadActiveSubscriptionTypes(
  ctx: Pick<QueryCtx, 'db'>,
): Promise<Doc<'subscriptionTypes'>[]> {
  return (await loadSubscriptionTypes(ctx)).filter((type) => type.active);
}

/** The shipped types, inserted when none exists: a tenant that removed or renamed them is left as it chose. */
export async function ensureDefaultSubscriptionTypes(
  ctx: MutationCtx,
  userId?: Id<'users'>,
): Promise<Id<'subscriptionTypes'>[]> {
  if ((await ctx.db.query('subscriptionTypes').first()) !== null) return [];
  const ids: Id<'subscriptionTypes'>[] = [];
  for (const [order, type] of DEFAULT_SUBSCRIPTION_TYPES.entries()) {
    ids.push(
      await ctx.db.insert('subscriptionTypes', {
        ...type,
        active: true,
        order,
        ...createAuditFields(userId),
      }),
    );
  }
  return ids;
}
