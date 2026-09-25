import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
// Trigger-wrapped: the lead patches must run the lead triggers (scoring, search).
import { internalMutation } from '../../_lib/functions';
import { ATTACH_BATCH, MAX_BEACON_EVENTS, VISITOR_ID_RE } from '../../_lib/validators/tracking';
import { isNotDeleted } from '../../lib/dbHelpers';
import { profilingExcluded } from '../../lib/leadSignals';
import { applyViewsToLead, cleanBeaconEvent, loadTrackingConfig, pathOf } from '../../lib/tracking';

const beaconEventValidator = v.object({
  u: v.string(),
  t: v.optional(v.string()),
  r: v.optional(v.string()),
  at: v.optional(v.number()),
});

/**
 * One beacon: the browser's id, its views, and the tracked-link token the landing URL carried, if any. Views of an
 * identified browser (named mode) land on its contact and mark it; the others wait, anonymous, for an identification.
 */
export const recordBeacon = internalMutation({
  args: {
    visitorId: v.string(),
    events: v.array(beaconEventValidator),
    linkToken: v.optional(v.string()),
  },
  returns: v.object({ stored: v.number() }),
  handler: async (ctx, args) => {
    const config = await loadTrackingConfig(ctx);
    if (!config.enabled || !VISITOR_ID_RE.test(args.visitorId)) return { stored: 0 };
    const now = Date.now();
    const events = args.events
      .slice(0, MAX_BEACON_EVENTS)
      .map((e) => cleanBeaconEvent(e, now))
      .filter((e): e is NonNullable<typeof e> => e !== null);
    if (events.length === 0) return { stored: 0 };

    const visitor = await ctx.db
      .query('webVisitors')
      .withIndex('by_visitor', (q) => q.eq('visitorId', args.visitorId))
      .first();
    const named = config.mode === 'named';
    let leadId = named ? visitor?.leadId : undefined;
    // A tracked link brought this browser here: the link's contact is who is browsing.
    if (named && !leadId && args.linkToken) {
      const token = await ctx.db
        .query('campaignLinkTokens')
        .withIndex('by_token', (q) => q.eq('token', args.linkToken as string))
        .first();
      const lead = token ? await ctx.db.get(token.leadId) : null;
      if (lead && isNotDeleted(lead) && !profilingExcluded(lead)) {
        leadId = lead._id;
        await identify(ctx, args.visitorId, visitor, lead._id, now);
      }
    }
    if (leadId) {
      const lead = await ctx.db.get(leadId);
      // A contact gone or objecting since: the browser goes back to anonymous.
      if (!lead || !isNotDeleted(lead) || profilingExcluded(lead)) {
        leadId = undefined;
        if (visitor?.leadId) await ctx.db.patch(visitor._id, { leadId: undefined });
      }
    }
    for (const e of events) {
      await ctx.db.insert('pageViews', {
        visitorId: args.visitorId,
        leadId,
        url: e.url,
        path: pathOf(e.url),
        title: e.title,
        referrer: e.referrer,
        at: e.at,
      });
    }
    if (visitor) {
      await ctx.db.patch(visitor._id, {
        lastSeenAt: Math.max(visitor.lastSeenAt, now),
        views: visitor.views + events.length,
      });
    } else {
      await ctx.db.insert('webVisitors', {
        visitorId: args.visitorId,
        leadId,
        firstSeenAt: now,
        lastSeenAt: now,
        views: events.length,
      });
    }
    if (leadId) {
      await applyViewsToLead(
        ctx,
        leadId,
        events.map((e) => ({ path: pathOf(e.url), at: e.at })),
      );
    }
    return { stored: events.length };
  },
});

/** Ties the browser to the contact and schedules the views that came before to follow. */
async function identify(
  ctx: Parameters<typeof applyViewsToLead>[0],
  visitorId: string,
  visitor: Doc<'webVisitors'> | null | undefined,
  leadId: Id<'leads'>,
  now: number,
): Promise<void> {
  if (visitor) {
    if (visitor.leadId === leadId) return;
    await ctx.db.patch(visitor._id, { leadId, lastSeenAt: Math.max(visitor.lastSeenAt, now) });
  } else {
    await ctx.db.insert('webVisitors', {
      visitorId,
      leadId,
      firstSeenAt: now,
      lastSeenAt: now,
      views: 0,
    });
  }
  await ctx.scheduler.runAfter(0, internal.features.tracking.internal.attachViews, {
    visitorId,
    leadId,
  });
}

/**
 * A browser became a contact (a form submitted, a tracked link clicked): in named mode its anonymous views join
 * the contact, in batches. Nothing for a deleted contact, a contact who objected to profiling, or anonymous mode.
 */
export const identifyVisitor = internalMutation({
  args: { visitorId: v.string(), leadId: v.id('leads') },
  returns: v.null(),
  handler: async (ctx, { visitorId, leadId }) => {
    const config = await loadTrackingConfig(ctx);
    if (!config.enabled || config.mode !== 'named' || !VISITOR_ID_RE.test(visitorId)) return null;
    const lead = await ctx.db.get(leadId);
    if (!lead || !isNotDeleted(lead) || profilingExcluded(lead)) return null;
    const visitor = await ctx.db
      .query('webVisitors')
      .withIndex('by_visitor', (q) => q.eq('visitorId', visitorId))
      .first();
    await identify(ctx, visitorId, visitor, leadId, Date.now());
    return null;
  },
});

/** One batch of a browser's anonymous views moved onto its contact, the contact marked once for the batch. */
export const attachViews = internalMutation({
  args: { visitorId: v.string(), leadId: v.id('leads') },
  returns: v.null(),
  handler: async (ctx, { visitorId, leadId }) => {
    const rows = await ctx.db
      .query('pageViews')
      .withIndex('by_visitor_at', (q) => q.eq('visitorId', visitorId))
      .filter((q) => q.eq(q.field('leadId'), undefined))
      .take(ATTACH_BATCH);
    for (const row of rows) await ctx.db.patch(row._id, { leadId });
    // These views came before the contact was known: their paths go in front of the ones already there.
    await applyViewsToLead(
      ctx,
      leadId,
      rows.map((r) => ({ path: r.path, at: r.at })),
      true,
    );
    if (rows.length === ATTACH_BATCH) {
      await ctx.scheduler.runAfter(0, internal.features.tracking.internal.attachViews, {
        visitorId,
        leadId,
      });
    }
    return null;
  },
});
