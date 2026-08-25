import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';
import { Triggers } from 'convex-helpers/server/triggers';
import type { DataModel } from '../_generated/dataModel';
import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
} from '../_generated/server';
import { companiesTotal, leadsByCompany } from '../lib/companyAggregates';
import { companySearchText } from '../lib/companySearch';
import { dealsByPipelineStatus, dealsByStage } from '../lib/dealAggregates';
import { leadsByLifecycle, leadsByOwner, leadsByStatus } from '../lib/leadAggregates';
import { leadSearchText } from '../lib/leadSearch';

const triggers = new Triggers<DataModel>();
// idempotentTrigger (not trigger): tolerates documents not yet registered in
// the aggregate, so patches to pre-backfill rows don't throw during the window
// between a deploy and its backfill run.
triggers.register('leads', leadsByStatus.idempotentTrigger());
triggers.register('leads', leadsByOwner.idempotentTrigger());
triggers.register('leads', leadsByLifecycle.idempotentTrigger());
triggers.register('leads', leadsByCompany.idempotentTrigger());
triggers.register('companies', companiesTotal.idempotentTrigger());
triggers.register('deals', dealsByStage.idempotentTrigger());
triggers.register('deals', dealsByPipelineStatus.idempotentTrigger());
// Keep the denormalized searchText in step with the identity fields (#12).
// The corrective patch re-fires the triggers once; the values then match and
// the recursion stops.
triggers.register('leads', async (ctx, change) => {
  if (change.operation === 'delete') return;
  const company = change.newDoc.companyId ? await ctx.db.get(change.newDoc.companyId) : null;
  const expected = leadSearchText(change.newDoc, company?.name);
  if (change.newDoc.searchText !== expected) {
    await ctx.db.patch(change.id, { searchText: expected });
  }
});
triggers.register('companies', async (ctx, change) => {
  if (change.operation === 'delete') return;
  const expected = companySearchText(change.newDoc);
  if (change.newDoc.searchText !== expected) {
    await ctx.db.patch(change.id, { searchText: expected });
  }
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
