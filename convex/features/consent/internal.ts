import { v } from 'convex/values';
import { internalMutation } from '../../_lib/functions';
import { subscriptionStatusValidator } from '../../_lib/validators/crm';
import { applyConsentChoice } from '../../lib/consent/choice';
import { leadForConsentWrite } from '../../lib/consent/token';

/** The preference centre's choice, per type or everything off, with the hash of the address it came from; an id that names no type is ignored. */
export const applyConsentByToken = internalMutation({
  args: {
    token: v.string(),
    types: v.optional(v.array(v.object({ id: v.string(), status: subscriptionStatusValidator }))),
    unsubscribeAll: v.optional(v.boolean()),
    ipHash: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(false), code: v.string() }),
    v.object({ ok: v.literal(true) }),
  ),
  handler: async (ctx, args) => {
    const found = await leadForConsentWrite(ctx, args.token);
    if ('error' in found) return { ok: false as const, code: found.error };
    const types = (args.types ?? []).flatMap(({ id, status }) => {
      const typeId = ctx.db.normalizeId('subscriptionTypes', id);
      return typeId ? [{ typeId, status }] : [];
    });
    await applyConsentChoice(
      ctx,
      found.lead,
      { types, unsubscribeAll: args.unsubscribeAll },
      { source: 'preference_center', ipHash: args.ipHash },
    );
    return { ok: true as const };
  },
});
