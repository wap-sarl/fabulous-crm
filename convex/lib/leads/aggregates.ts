import { TableAggregate } from '@convex-dev/aggregate';
import { components } from '../../_generated/api';
import type { DataModel, Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { whenMoved } from '../shared/aggregates';

const aliveness = (doc: Doc<'leads'>): 0 | 1 => (doc.deletedAt != null ? 1 : 0);

const leadsByOwnerPlace = {
  namespace: (doc: Doc<'leads'>) => doc.ownerIds[0] ?? null,
  sortKey: (doc: Doc<'leads'>): [0 | 1, string] => [aliveness(doc), doc.lifecycleStage ?? ''],
};
const leadsByOwner = new TableAggregate<{
  Namespace: Id<'users'> | null;
  Key: [0 | 1, string];
  DataModel: DataModel;
  TableName: 'leads';
}>(components.leadsByOwner, leadsByOwnerPlace);
export const leadsByOwnerTrigger = whenMoved(
  leadsByOwner.idempotentTrigger<MutationCtx>(),
  leadsByOwnerPlace,
);

const leadsByLifecyclePlace = {
  namespace: (doc: Doc<'leads'>) => doc.lifecycleStage ?? null,
  sortKey: aliveness,
};
export const leadsByLifecycle = new TableAggregate<{
  Namespace: string | null;
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'leads';
}>(components.leadsByLifecycle, leadsByLifecyclePlace);
export const leadsByLifecycleTrigger = whenMoved(
  leadsByLifecycle.idempotentTrigger<MutationCtx>(),
  leadsByLifecyclePlace,
);

export async function countLiveLeadsByLifecycleStage(
  ctx: QueryCtx,
  stage: string | null,
): Promise<number> {
  return await leadsByLifecycle.count(ctx, {
    namespace: stage,
    bounds: { lower: { key: 0, inclusive: true }, upper: { key: 0, inclusive: true } },
  });
}

/** Counts by primary owner only, null being unowned; the stage '' means unset, and an omitted stage means any. */
export async function countLiveLeadsByOwner(
  ctx: QueryCtx,
  owner: Id<'users'> | null,
  stage?: string,
): Promise<number> {
  return await leadsByOwner.count(ctx, {
    namespace: owner,
    bounds:
      stage === undefined
        ? { prefix: [0] }
        : {
            lower: { key: [0, stage], inclusive: true },
            upper: { key: [0, stage], inclusive: true },
          },
  });
}
