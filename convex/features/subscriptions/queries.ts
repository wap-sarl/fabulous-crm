import { v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';
import { marketingConsentChannelValidator } from '../../_lib/validators/crm';
import { legalBasisValidator } from '../../_lib/validators/subscriptions';
import { loadSubscriptionTypes } from '../../lib/consent/types';

/** Every type in order, for the settings and for the pickers (filters, campaigns, triggers), which show the inactive ones greyed. */
export const listSubscriptionTypes = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('subscriptionTypes'),
      name: v.string(),
      description: v.optional(v.string()),
      channel: marketingConsentChannelValidator,
      active: v.boolean(),
      legalBasis: legalBasisValidator,
      order: v.number(),
    }),
  ),
  handler: async (ctx) =>
    (await loadSubscriptionTypes(ctx)).map((type) => ({
      _id: type._id,
      name: type.name,
      description: type.description,
      channel: type.channel,
      active: type.active,
      legalBasis: type.legalBasis,
      order: type.order,
    })),
});
