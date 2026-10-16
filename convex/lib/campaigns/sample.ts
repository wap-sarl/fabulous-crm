import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import { EXCLUDED_CAMPAIGNS_MAX } from '../../_lib/validators/crm';
import { follows, positiveIntSchema } from '../../_lib/validators/fields';

// A campaign's recipients narrowed down: the contacts of other campaigns left out, a random share kept.

/** At most a handful of live campaigns, each one in the caller's reach. */
export async function checkExcludedCampaigns(
  ctx: MutationCtx,
  ids: Id<'campaigns'>[] | undefined,
): Promise<Id<'campaigns'>[] | undefined> {
  if (!ids?.length) return undefined;
  const unique = [...new Set(ids)];
  if (unique.length > EXCLUDED_CAMPAIGNS_MAX) throw refusal('excluded_campaigns_too_many');
  for (const id of unique) {
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.deletedAt != null) throw refusal('campaign_not_found');
  }
  return unique;
}

/** A whole number of contacts, out of at least as many. */
export function checkSample(sample: { size: number; of: number }): void {
  if (!follows(positiveIntSchema, sample.size) || !follows(positiveIntSchema, sample.of)) {
    throw refusal('campaign_sample_invalid');
  }
  if (sample.size > sample.of) throw refusal('campaign_sample_invalid', { reason: 'size' });
}

/** Whether one contact already has a send in one of the excluded campaigns: a contact's sends are few. */
export async function sentByExcluded(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  excluded: Set<string>,
): Promise<boolean> {
  const sends = await ctx.db
    .query('campaignSends')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .collect();
  return sends.some((send) => excluded.has(send.campaignId));
}
