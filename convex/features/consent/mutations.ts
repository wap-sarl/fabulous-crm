import { v } from 'convex/values';
import { mutation } from '../../_lib/functions';
import { computeChanges, logAudit } from '../../lib/audit/log';
import { marketingConsentChannelValidator } from '../../schema';
import { enforceRateLimit } from '../../lib/security/rateLimits';
import { dispatchWorkflowTrigger } from '../../lib/workflows/dispatch';

/** PUBLIC (no auth): the consent token is the only credential, for the unauthenticated RGPD consent page. */
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
    const lead = await ctx.db
      .query('leads')
      .withIndex('by_consentToken', (q) => q.eq('consentToken', args.token))
      .first();
    if (!lead || lead.deletedAt != null) {
      // Global enumeration guard: invalid tokens share one small bucket.
      const ok = await enforceRateLimit(ctx, 'consentInvalid');
      return {
        success: false as const,
        error: ok ? ('invalid_token' as const) : ('rate_limited' as const),
      };
    }
    if (!(await enforceRateLimit(ctx, 'consentUpdate', args.token))) {
      return { success: false as const, error: 'rate_limited' };
    }

    const channels = [...new Set(args.channels)];
    await ctx.db.patch(lead._id, {
      marketingConsent: channels,
      consentUpdatedAt: Date.now(),
      consentSource: 'public_link',
      updatedAt: Date.now(),
    });
    // Re-submitting the same choice changes nothing worth reporting.
    const changes = computeChanges(lead, { marketingConsent: channels });
    if (changes) {
      await logAudit({
        ctx,
        entityType: 'lead',
        entityId: lead._id,
        action: 'update',
        metadata: { source: 'public_link', changes },
      });
    }

    await dispatchWorkflowTrigger(ctx, lead._id, { type: 'consent_updated' });

    return { success: true as const };
  },
});
