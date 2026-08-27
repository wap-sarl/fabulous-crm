import { TableAggregate } from '@convex-dev/aggregate';
import { components } from '../_generated/api';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { DealStatus } from '../_lib/validators/deals';

const aliveness = (doc: Doc<'deals'>): 0 | 1 => (doc.deletedAt != null ? 1 : 0);
const amount = (doc: Doc<'deals'>): number => doc.amount ?? 0;

export const stageNamespace = (pipelineId: Id<'pipelines'>, stageKey: string) =>
  `${pipelineId}|${stageKey}`;
export const statusNamespace = (pipelineId: Id<'pipelines'>, status: DealStatus) =>
  `${pipelineId}|${status}`;

export const dealsByStage = new TableAggregate<{
  Namespace: string;
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'deals';
}>(components.dealsByStage, {
  namespace: (doc) => stageNamespace(doc.pipelineId, doc.stageKey),
  sortKey: aliveness,
  sumValue: amount,
});

export const dealsByPipelineStatus = new TableAggregate<{
  Namespace: string;
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'deals';
}>(components.dealsByPipelineStatus, {
  namespace: (doc) => statusNamespace(doc.pipelineId, doc.status),
  sortKey: aliveness,
  sumValue: amount,
});

/**
 * Per primary owner (see leadsByOwner for the multi-owner rule), keyed by
 * stage / status: a scoped (own / team) pipeline board sums its owners'
 * namespaces instead of reading the global aggregates.
 */
export const dealsByOwnerStage = new TableAggregate<{
  Namespace: Id<'users'> | null;
  Key: [0 | 1, string, string];
  DataModel: DataModel;
  TableName: 'deals';
}>(components.dealsByOwnerStage, {
  namespace: (doc) => doc.ownerIds[0] ?? null,
  sortKey: (doc) => [aliveness(doc), doc.pipelineId, doc.stageKey],
  sumValue: amount,
});

export const dealsByOwnerStatus = new TableAggregate<{
  Namespace: Id<'users'> | null;
  Key: [0 | 1, string, DealStatus];
  DataModel: DataModel;
  TableName: 'deals';
}>(components.dealsByOwnerStatus, {
  namespace: (doc) => doc.ownerIds[0] ?? null,
  sortKey: (doc) => [aliveness(doc), doc.pipelineId, doc.status],
  sumValue: amount,
});

const LIVE = {
  lower: { key: 0 as const, inclusive: true },
  upper: { key: 0 as const, inclusive: true },
};

export type DealTotals = { count: number; amount: number };

export async function stageTotals(
  ctx: QueryCtx,
  pipelineId: Id<'pipelines'>,
  stageKey: string,
): Promise<DealTotals> {
  const namespace = stageNamespace(pipelineId, stageKey);
  return {
    count: await dealsByStage.count(ctx, { namespace, bounds: LIVE }),
    amount: await dealsByStage.sum(ctx, { namespace, bounds: LIVE }),
  };
}

export async function statusTotals(
  ctx: QueryCtx,
  pipelineId: Id<'pipelines'>,
  status: DealStatus,
): Promise<DealTotals> {
  const namespace = statusNamespace(pipelineId, status);
  return {
    count: await dealsByPipelineStatus.count(ctx, { namespace, bounds: LIVE }),
    amount: await dealsByPipelineStatus.sum(ctx, { namespace, bounds: LIVE }),
  };
}

/** Stage totals restricted to the deals whose primary owner is one of `owners`. */
export async function scopedStageTotals(
  ctx: QueryCtx,
  owners: (Id<'users'> | null)[],
  pipelineId: Id<'pipelines'>,
  stageKey: string,
): Promise<DealTotals> {
  const totals = { count: 0, amount: 0 };
  for (const owner of owners) {
    const bounds = { prefix: [0, pipelineId as string, stageKey] as [0, string, string] };
    totals.count += await dealsByOwnerStage.count(ctx, { namespace: owner, bounds });
    totals.amount += await dealsByOwnerStage.sum(ctx, { namespace: owner, bounds });
  }
  return totals;
}

/** Status totals restricted to the deals whose primary owner is one of `owners`. */
export async function scopedStatusTotals(
  ctx: QueryCtx,
  owners: (Id<'users'> | null)[],
  pipelineId: Id<'pipelines'>,
  status: DealStatus,
): Promise<DealTotals> {
  const totals = { count: 0, amount: 0 };
  for (const owner of owners) {
    const bounds = { prefix: [0, pipelineId as string, status] as [0, string, DealStatus] };
    totals.count += await dealsByOwnerStatus.count(ctx, { namespace: owner, bounds });
    totals.amount += await dealsByOwnerStatus.sum(ctx, { namespace: owner, bounds });
  }
  return totals;
}
