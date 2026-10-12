import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { marketingConsentChannelValidator } from '../../_lib/validators/crm';
import { isSubscribed, legalBasisValidator } from '../../_lib/validators/subscriptions';
import { loadActiveSubscriptionTypes } from '../../lib/consent/types';
import { leadOfConsentToken } from '../../lib/consent/token';

/** PUBLIC (no auth), for the preference centre: the person's name, their channels, and each active type with where they stand on it; nothing else about the lead. */
export const getConsentByToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      firstName: v.string(),
      lastName: v.string(),
      marketingConsent: v.array(marketingConsentChannelValidator),
      types: v.array(
        v.object({
          _id: v.id('subscriptionTypes'),
          name: v.string(),
          description: v.optional(v.string()),
          channel: marketingConsentChannelValidator,
          legalBasis: legalBasisValidator,
          subscribed: v.boolean(),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const lead = await leadOfConsentToken(ctx, args.token);
    if (!lead) return null;
    const types = await loadActiveSubscriptionTypes(ctx);
    return {
      firstName: lead.firstName,
      lastName: lead.lastName,
      marketingConsent: lead.marketingConsent,
      types: types.map((type) => ({
        _id: type._id,
        name: type.name,
        description: type.description,
        channel: type.channel,
        legalBasis: type.legalBasis,
        subscribed: isSubscribed(lead, type),
      })),
    };
  },
});
