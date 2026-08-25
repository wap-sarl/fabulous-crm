import { TableAggregate } from '@convex-dev/aggregate';
import { components } from '../_generated/api';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

const aliveness = (doc: { deletedAt?: number }): 0 | 1 => (doc.deletedAt != null ? 1 : 0);

export const companiesTotal = new TableAggregate<{
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'companies';
}>(components.companiesTotal, { sortKey: aliveness });

/** Lead count per company (namespace = companyId or null, key = aliveness bit). */
export const leadsByCompany = new TableAggregate<{
  Namespace: Id<'companies'> | null;
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'leads';
}>(components.leadsByCompany, {
  namespace: (doc: Doc<'leads'>) => doc.companyId ?? null,
  sortKey: aliveness,
});

const LIVE_BOUNDS = {
  lower: { key: 0 as const, inclusive: true },
  upper: { key: 0 as const, inclusive: true },
};

export async function countLiveCompanies(ctx: QueryCtx): Promise<number> {
  return await companiesTotal.count(ctx, { bounds: LIVE_BOUNDS });
}

/** Live leads attached to `companyId`. */
export async function countLiveLeadsByCompany(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
): Promise<number> {
  return await leadsByCompany.count(ctx, { namespace: companyId, bounds: LIVE_BOUNDS });
}
