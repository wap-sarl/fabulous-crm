import { TableAggregate } from '@convex-dev/aggregate';
import { components } from '../_generated/api';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

const aliveness = (doc: Doc<'leads'>): 0 | 1 => (doc.deletedAt != null ? 1 : 0);

/** Lead count per owner (namespace = assignedTo or null, key = aliveness bit). */
export const leadsByOwner = new TableAggregate<{
  Namespace: Id<'users'> | null;
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'leads';
}>(components.leadsByOwner, {
  namespace: (doc) => doc.assignedTo ?? null,
  sortKey: aliveness,
});

export const leadsByLifecycle = new TableAggregate<{
  Namespace: string | null;
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'leads';
}>(components.leadsByLifecycle, {
  namespace: (doc) => doc.lifecycleStage ?? null,
  sortKey: aliveness,
});

export async function countLiveLeadsByLifecycleStage(
  ctx: QueryCtx,
  stage: string | null,
): Promise<number> {
  return await leadsByLifecycle.count(ctx, {
    namespace: stage,
    bounds: { lower: { key: 0, inclusive: true }, upper: { key: 0, inclusive: true } },
  });
}

/** Count the live (non-soft-deleted) leads assigned to `owner` (null = unassigned). */
export async function countLiveLeadsByOwner(
  ctx: QueryCtx,
  owner: Id<'users'> | null,
): Promise<number> {
  return await leadsByOwner.count(ctx, {
    namespace: owner,
    bounds: { lower: { key: 0, inclusive: true }, upper: { key: 0, inclusive: true } },
  });
}
