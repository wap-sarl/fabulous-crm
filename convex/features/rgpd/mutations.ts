import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { settingsMutation } from '../../_lib/auth';
import { logAudit } from '../../lib';
import { NO_VIEW_MARKS, stopLeadTracking } from '../../lib/tracking';

/** Right to erasure: recorded, then done in scheduled steps that outlive this call; the contact may already be in the trash. */
export const eraseContact = settingsMutation({
  args: { leadId: v.id('leads'), confirm: v.boolean() },
  returns: v.id('rgpdRequests'),
  handler: async (ctx, { leadId, confirm }) => {
    if (!confirm) throw new Error('erasure_not_confirmed');
    const lead = await ctx.db.get(leadId);
    if (!lead) throw new Error('lead_not_found');
    const requestId = await ctx.db.insert('rgpdRequests', {
      type: 'erasure',
      leadId,
      requestedBy: ctx.userId,
      requestedAt: Date.now(),
      outcome: 'in_progress',
    });
    await ctx.scheduler.runAfter(0, internal.features.rgpd.internal.eraseStep, {
      leadId,
      requestId,
      userId: ctx.userId,
    });
    return requestId;
  },
});

/** Right to object to profiling: the flag, the score cleared by the trigger, the page views detached, the request on the record. */
export const setProfilingExclusion = settingsMutation({
  args: { leadId: v.id('leads'), exclude: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { leadId, exclude }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt !== undefined) throw new Error('lead_not_found');
    if ((lead.excludeFromProfiling ?? false) === exclude) return null;
    await ctx.db.patch(leadId, {
      excludeFromProfiling: exclude || undefined,
      ...(exclude && NO_VIEW_MARKS),
      updatedAt: Date.now(),
    });
    // The browsers and their views go back to anonymous now, not at the next beacon.
    if (exclude) await stopLeadTracking(ctx, leadId);
    const now = Date.now();
    await ctx.db.insert('rgpdRequests', {
      type: exclude ? 'objection' : 'objection_lifted',
      leadId,
      requestedBy: ctx.userId,
      requestedAt: now,
      completedAt: now,
      outcome: 'done',
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'lead',
      entityId: leadId,
      action: 'update',
      metadata: { rgpd: exclude ? 'objection' : 'objection_lifted' },
    });
    return null;
  },
});
