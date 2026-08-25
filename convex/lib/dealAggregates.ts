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
