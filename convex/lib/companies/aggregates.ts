import { TableAggregate } from '@convex-dev/aggregate';
import { components } from '../../_generated/api';
import type { DataModel, Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { LIVE_BOUNDS, whenMoved } from '../shared/aggregates';

const aliveness = (doc: { deletedAt?: number }): 0 | 1 => (doc.deletedAt != null ? 1 : 0);

const companiesTotalPlace = { sortKey: aliveness };
const companiesTotal = new TableAggregate<{
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'companies';
}>(components.companiesTotal, companiesTotalPlace);
export const companiesTotalTrigger = whenMoved(
  companiesTotal.idempotentTrigger<MutationCtx>(),
  companiesTotalPlace,
);

/** Company count per primary owner (namespace = ownerIds[0] or null, key = aliveness bit). */
const companiesByOwnerPlace = {
  namespace: (doc: Doc<'companies'>) => doc.ownerIds[0] ?? null,
  sortKey: aliveness,
};
const companiesByOwner = new TableAggregate<{
  Namespace: Id<'users'> | null;
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'companies';
}>(components.companiesByOwner, companiesByOwnerPlace);
export const companiesByOwnerTrigger = whenMoved(
  companiesByOwner.idempotentTrigger<MutationCtx>(),
  companiesByOwnerPlace,
);

/** Lead count per company (namespace = companyId or null, key = aliveness bit). */
const leadsByCompanyPlace = {
  namespace: (doc: Doc<'leads'>) => doc.companyId ?? null,
  sortKey: aliveness,
};
const leadsByCompany = new TableAggregate<{
  Namespace: Id<'companies'> | null;
  Key: 0 | 1;
  DataModel: DataModel;
  TableName: 'leads';
}>(components.leadsByCompany, leadsByCompanyPlace);
export const leadsByCompanyTrigger = whenMoved(
  leadsByCompany.idempotentTrigger<MutationCtx>(),
  leadsByCompanyPlace,
);

export async function countLiveCompanies(ctx: QueryCtx): Promise<number> {
  return await companiesTotal.count(ctx, { bounds: LIVE_BOUNDS });
}

/** Live companies whose primary owner is `owner` (null = unowned). */
export async function countLiveCompaniesByOwner(
  ctx: QueryCtx,
  owner: Id<'users'> | null,
): Promise<number> {
  return await companiesByOwner.count(ctx, { namespace: owner, bounds: LIVE_BOUNDS });
}

/** Live leads attached to `companyId`. */
export async function countLiveLeadsByCompany(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
): Promise<number> {
  return await leadsByCompany.count(ctx, { namespace: companyId, bounds: LIVE_BOUNDS });
}
