import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';
import { Triggers } from 'convex-helpers/server/triggers';
import type { DataModel } from '../_generated/dataModel';
import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
} from '../_generated/server';
import { activitiesByOwner, activitiesByTeam } from '../lib/activityAggregates';
import { companiesByOwner, companiesTotal, leadsByCompany } from '../lib/companyAggregates';
import { companySearchText } from '../lib/companySearch';
import {
  dealsByOwnerStage,
  dealsByOwnerStatus,
  dealsByPipelineStatus,
  dealsByStage,
} from '../lib/dealAggregates';
import { leadsByLifecycle, leadsByOwner } from '../lib/leadAggregates';
import type { LeadDedupe } from './validators/duplicates';
import { dedupeKeys } from '../lib/duplicates';
import { syncLeadDynamicLists } from '../lib/dynamicLists';
import { leadSearchText } from '../lib/leadSearch';

const triggers = new Triggers<DataModel>();

/** Key-by-key equality of the dedupe objects (key order and unset keys aside). */
const sameDedupe = (a: LeadDedupe | undefined, b: LeadDedupe): boolean =>
  a !== undefined &&
  a.name === b.name &&
  a.phone === b.phone &&
  a.block === b.block &&
  a.postal === b.postal;
// idempotentTrigger (not trigger): tolerates documents not registered in the
// aggregate (rows inserted outside the wrapper, e.g. test seeds), so a patch
// never throws on them.
triggers.register('leads', leadsByOwner.idempotentTrigger());
triggers.register('leads', leadsByLifecycle.idempotentTrigger());
triggers.register('leads', leadsByCompany.idempotentTrigger());
triggers.register('companies', companiesTotal.idempotentTrigger());
triggers.register('deals', dealsByStage.idempotentTrigger());
triggers.register('deals', dealsByPipelineStatus.idempotentTrigger());
triggers.register('activities', activitiesByOwner.idempotentTrigger());
triggers.register('activities', activitiesByTeam.idempotentTrigger());
triggers.register('companies', companiesByOwner.idempotentTrigger());
triggers.register('deals', dealsByOwnerStage.idempotentTrigger());
triggers.register('deals', dealsByOwnerStatus.idempotentTrigger());
triggers.register('leads', async (ctx, change) => {
  if (change.operation === 'delete') return;
  const company = change.newDoc.companyId ? await ctx.db.get(change.newDoc.companyId) : null;
  const searchText = leadSearchText(change.newDoc, company?.name);
  const dedupe = dedupeKeys(change.newDoc);
  const patch: { searchText?: string; dedupe?: typeof dedupe } = {};
  if (change.newDoc.searchText !== searchText) patch.searchText = searchText;
  if (!sameDedupe(change.newDoc.dedupe, dedupe)) patch.dedupe = dedupe;
  if (Object.keys(patch).length > 0) await ctx.db.patch(change.id, patch);
});
triggers.register('leads', syncLeadDynamicLists);
triggers.register('companies', async (ctx, change) => {
  if (change.operation === 'delete') return;
  const expected = companySearchText(change.newDoc);
  if (change.newDoc.searchText !== expected) {
    await ctx.db.patch(change.id, { searchText: expected });
  }
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
