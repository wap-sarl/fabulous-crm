import { v } from 'convex/values';
import { mutation } from '../../_lib/functions';
import { marketingConsentChannelValidator } from '../../schema';
import { applyConsentChoice } from '../../lib/consent/choice';
import { leadForConsentWrite } from '../../lib/consent/token';

/** PUBLIC (no auth): the consent token is the only credential. The per-channel choice, kept for the callers that have it; the preference centre writes through POST /consent/<token>, which keeps the address as a hash. */
export const updateConsentByToken = mutation({
  args: {
    token: v.string(),
    channels: v.array(marketingConsentChannelValidator),
  },
  returns: v.union(
    v.object({ success: v.literal(false), error: v.string() }),
    v.object({ success: v.literal(true) }),
  ),
  handler: async (ctx, args) => {
    const found = await leadForConsentWrite(ctx, args.token);
    if ('error' in found) return { success: false as const, error: found.error };
    await applyConsentChoice(
      ctx,
      found.lead,
      { channels: [...new Set(args.channels)] },
      { source: 'public_link' },
    );
    return { success: true as const };
  },
});
