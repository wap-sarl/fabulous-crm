import type { Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import { EXCLUDED_CAMPAIGNS_MAX } from '../../_lib/validators/crm';
import { follows, positiveIntSchema } from '../../_lib/validators/fields';

// A campaign's recipients narrowed down: the contacts of other campaigns left out, a random share kept.

/** Index ranges one transaction may read: a page of contacts times the exclusion lookups of each stays under it. */
const RANGES_PER_PAGE = 3000;
export const pageSizeWithExclusions = (page: number, excluded: number): number =>
  Math.min(page, Math.floor(RANGES_PER_PAGE / (1 + excluded)));

/** The recipient extras of a new campaign, checked together: the excluded campaigns it keeps, the sample it was asked. */
export async function checkRecipientExtras(
  ctx: MutationCtx,
  args: { excludeCampaignIds?: Id<'campaigns'>[]; sample?: { size: number; of: number } },
): Promise<Id<'campaigns'>[] | undefined> {
  if (args.sample) checkSample(args.sample);
  return await checkExcludedCampaigns(ctx, args.excludeCampaignIds);
}

/** At most a handful of live campaigns, each one in the caller's reach. */
async function checkExcludedCampaigns(
  ctx: MutationCtx,
  ids: Id<'campaigns'>[] | undefined,
): Promise<Id<'campaigns'>[] | undefined> {
  if (!ids?.length) return undefined;
  const unique = [...new Set(ids)];
  if (unique.length > EXCLUDED_CAMPAIGNS_MAX) {
    throw refusal('excluded_campaigns_too_many', {
      message: `Au plus ${EXCLUDED_CAMPAIGNS_MAX} campagnes exclues.`,
    });
  }
  for (const id of unique) {
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.deletedAt != null) {
      throw refusal('campaign_not_found', { message: 'Une campagne exclue n’existe plus.' });
    }
  }
  return unique;
}

/** A whole number of contacts, out of at least as many. */
function checkSample(sample: { size: number; of: number }): void {
  const message = 'Échantillon : un nombre entier de contacts, au plus le total correspondant.';
  if (!follows(positiveIntSchema, sample.size) || !follows(positiveIntSchema, sample.of)) {
    throw refusal('campaign_sample_invalid', { message });
  }
  if (sample.size > sample.of)
    throw refusal('campaign_sample_invalid', { reason: 'size', message });
}

/** Whether one contact has a send in one of the excluded campaigns: one point read per campaign, at most EXCLUDED_CAMPAIGNS_MAX. */
export async function sentByExcluded(
  ctx: QueryCtx | MutationCtx,
  leadId: Id<'leads'>,
  excluded: Id<'campaigns'>[],
): Promise<boolean> {
  for (const campaignId of excluded) {
    const send = await ctx.db
      .query('campaignSends')
      .withIndex('by_lead_campaign', (q) => q.eq('leadId', leadId).eq('campaignId', campaignId))
      .first();
    if (send) return true;
  }
  return false;
}
