import type { MutationCtx } from '../../_generated/server';
import { LINK_GRANT_MS } from '../../_lib/validators/tracking';
import { computeChanges, logAudit } from '../audit/log';
import { insertSystemNote } from '../leads/notes';
import { profilingExcluded } from '../leads/signals';
import { buildLeadTargetPatch } from '../leads/targets';
import { loadTrackingConfig, namedTracking, onAllowedSite } from '../tracking/config';
import { dispatchWorkflowTrigger } from '../workflows/dispatch';
import { diffLeadFilterFields } from '../workflows/rules';

/** Behind the public GET /l/<token> route, so no authenticated user: a repeated click re-applies the same value and adds an event, and a system note records the first click; `grantHash` is the hash of the one-time value the route may put in the landing URL (named tracking). */
export async function clickTrackedLink(
  ctx: MutationCtx,
  args: { token: string; grantHash?: string },
): Promise<{ found: boolean; redirectUrl?: string; identify?: boolean }> {
  const tokenRow = await ctx.db
    .query('campaignLinkTokens')
    .withIndex('by_token', (q) => q.eq('token', args.token))
    .first();
  if (!tokenRow) return { found: false };

  const campaign = await ctx.db.get(tokenRow.campaignId);
  const link = campaign?.trackedLinks?.find((l) => l.key === tokenRow.linkKey);
  // The person objected to profiling: the link still leads where it should, and nothing is written down.
  if (profilingExcluded(await ctx.db.get(tokenRow.leadId))) {
    return { found: true, redirectUrl: link?.redirectUrl, identify: false };
  }

  const now = Date.now();
  const firstClick = tokenRow.clickedAt === undefined;
  if (firstClick) await ctx.db.patch(tokenRow._id, { clickedAt: now });

  const send = await ctx.db.get(tokenRow.sendId);
  if (send && send.clickedAt === undefined) {
    await ctx.db.patch(tokenRow.sendId, { clickedAt: now });
  }

  // Event log: every click is recorded, unlike the first-only stamps above.
  await ctx.db.insert('campaignEvents', {
    campaignId: tokenRow.campaignId,
    sendId: tokenRow.sendId,
    leadId: tokenRow.leadId,
    type: 'link_click',
    eventAt: now,
    linkKey: tokenRow.linkKey,
    linkLabel: link?.label,
  });

  await dispatchWorkflowTrigger(ctx, tokenRow.leadId, {
    type: 'tracked_link_click',
    campaignId: tokenRow.campaignId,
    linkKey: tokenRow.linkKey,
  });

  // The redirect still happens when the lead or a custom-property definition disappeared since the campaign was sent.
  const lead = await ctx.db.get(tokenRow.leadId);
  if (link && lead && lead.deletedAt === undefined) {
    const patch = await buildLeadTargetPatch(ctx, lead, link.target, link.value);
    if (patch) {
      const changedFields = diffLeadFilterFields(lead, patch);
      await ctx.db.patch(lead._id, { ...patch, updatedAt: now });
      const changes = computeChanges(lead, patch);
      if (changes) {
        await logAudit({
          ctx,
          entityType: 'lead',
          entityId: lead._id,
          action: 'update',
          metadata: { source: 'tracked_link', campaignId: tokenRow.campaignId, changes },
        });
      }
      if (changedFields.length > 0) {
        await dispatchWorkflowTrigger(ctx, lead._id, {
          type: 'lead_property_changed',
          changedFields,
        });
      }
      if (firstClick) {
        // Mirroring the SMS opt-out timeline entry.
        await insertSystemNote(
          ctx,
          lead._id,
          `Lien cliqué : ${link.label} (campagne « ${campaign?.name} »).`,
          now,
        );
      }
    }
  }

  // Named tracking, a link that lands on a tracked site: the click may identify the browser, once and for a short while.
  const tracking = await loadTrackingConfig(ctx);
  const identify =
    args.grantHash !== undefined &&
    namedTracking(tracking) &&
    onAllowedSite(tracking, link?.redirectUrl);
  if (identify) {
    await ctx.db.patch(tokenRow._id, {
      identifyHash: args.grantHash,
      identifyUntil: now + LINK_GRANT_MS,
    });
  }
  return { found: true, redirectUrl: link?.redirectUrl, identify };
}
