import { marketingConsentChannelValidator } from '../../_lib/validators/crm';
import { v } from 'convex/values';
import { query } from '../../_generated/server';
import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { isNotDeleted } from '../../_lib/softDelete';

/** PUBLIC (no auth), for the RGPD consent page: returns only what the form needs, nothing else about the lead. */
export const getConsentByToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      firstName: v.string(),
      lastName: v.string(),
      marketingConsent: v.array(marketingConsentChannelValidator),
    }),
    v.null(),
  ),
  handler: async (ctx: QueryCtx, args) => {
    const lead = await getLeadByConsentToken(ctx, args.token);
    if (!lead) return null;
    return {
      firstName: lead.firstName,
      lastName: lead.lastName,
      marketingConsent: lead.marketingConsent,
    };
  },
});

async function getLeadByConsentToken(ctx: QueryCtx, token: string): Promise<Doc<'leads'> | null> {
  if (!token) return null;
  const lead = await ctx.db
    .query('leads')
    .withIndex('by_consentToken', (q) => q.eq('consentToken', token))
    .first();
  if (!lead || !isNotDeleted(lead)) return null;
  return lead;
}
