import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';
import { Triggers } from 'convex-helpers/server/triggers';
import type { DataModel } from '../_generated/dataModel';
import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
} from '../_generated/server';
import { activitiesByOwnerTrigger, activitiesByTeamTrigger } from '../lib/activities/aggregates';
import {
  companiesByOwnerTrigger,
  companiesTotalTrigger,
  leadsByCompanyTrigger,
} from '../lib/companies/aggregates';
import { campaignStatsTrigger } from '../lib/campaigns/stats';
import { companySearchText } from '../lib/companies/search';
import {
  dealsByOwnerStageTrigger,
  dealsByOwnerStatusTrigger,
  dealsByPipelineStatusTrigger,
  dealsByStageTrigger,
} from '../lib/deals/aggregates';
import { leadsByLifecycleTrigger, leadsByOwnerTrigger } from '../lib/leads/aggregates';
import type { LeadDedupe } from './validators/duplicates';
import { dedupeKeys } from '../lib/duplicates/detection';
import { syncLeadDynamicLists } from '../lib/leadLists/dynamic';
import { syncLeadScore } from '../lib/scoring/score';
import { leadSearchText } from '../lib/leads/search';

const triggers = new Triggers<DataModel>();

/** Key-by-key equality of the dedupe objects (key order and unset keys aside). */
const sameDedupe = (a: LeadDedupe | undefined, b: LeadDedupe): boolean =>
  a !== undefined &&
  a.name === b.name &&
  a.phone === b.phone &&
  a.block === b.block &&
  a.postal === b.postal;
// Each is an idempotentTrigger, not a trigger: a patch must not throw on a row the aggregate never saw (inserted outside the wrapper, e.g. test seeds).
triggers.register('leads', leadsByOwnerTrigger);
triggers.register('leads', leadsByLifecycleTrigger);
triggers.register('leads', leadsByCompanyTrigger);
triggers.register('companies', companiesTotalTrigger);
triggers.register('deals', dealsByStageTrigger);
triggers.register('deals', dealsByPipelineStatusTrigger);
triggers.register('activities', activitiesByOwnerTrigger);
triggers.register('activities', activitiesByTeamTrigger);
triggers.register('companies', companiesByOwnerTrigger);
triggers.register('deals', dealsByOwnerStageTrigger);
triggers.register('deals', dealsByOwnerStatusTrigger);
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
triggers.register('leads', syncLeadScore);
triggers.register('leads', syncLeadDynamicLists);
triggers.register('campaignSends', campaignStatsTrigger);
triggers.register('companies', async (ctx, change) => {
  if (change.operation === 'delete') return;
  const expected = companySearchText(change.newDoc);
  if (change.newDoc.searchText !== expected) {
    await ctx.db.patch(change.id, { searchText: expected });
  }
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
