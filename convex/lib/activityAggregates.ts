import { TableAggregate } from '@convex-dev/aggregate';
import { components } from '../_generated/api';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { activityDueKey, type ActivityStatus } from '../_lib/validators/activities';

export const ownerNamespace = (ownerId: Id<'users'>, status: ActivityStatus, deleted: boolean) =>
  `${ownerId}|${status}|${deleted ? 'deleted' : 'live'}`;

export const activitiesByOwner = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: 'activities';
}>(components.activitiesByOwner, {
  namespace: (doc: Doc<'activities'>) =>
    ownerNamespace(doc.ownerId, doc.status, doc.deletedAt != null),
  sortKey: activityDueKey,
});

/** Live activities of `owner` in `status` whose due key is in [from, to). */
export async function countActivitiesDue(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  status: ActivityStatus,
  from: number,
  to: number,
): Promise<number> {
  return await activitiesByOwner.count(ctx, {
    namespace: ownerNamespace(ownerId, status, false),
    bounds: { lower: { key: from, inclusive: true }, upper: { key: to, inclusive: false } },
  });
}
