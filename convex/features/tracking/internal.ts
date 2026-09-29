import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
// Trigger-wrapped: the lead patches must run the lead triggers (scoring, search).
import { internalMutation } from '../../_lib/functions';
import {
  ATTACH_BATCH,
  beaconViewValidator,
  CEILING_NOTE_MS,
  FLUSH_MS,
} from '../../_lib/validators/tracking';
import { isNotDeleted } from '../../lib/shared/db';
import { profilingExcluded } from '../../lib/leads/signals';
import {
  addMarks,
  applyViewsToLead,
  detachLeadTracking,
  loadTrackingConfig,
  marksOf,
  namedTracking,
  NO_VIEW_MARKS,
  refreshViewMarks,
} from '../../lib/tracking/views';

/** A contact tracking may write on: there, live, and not objecting to profiling. */
async function trackableLead(
  ctx: MutationCtx,
  leadId: Id<'leads'> | undefined,
): Promise<Doc<'leads'> | null> {
  const lead = leadId ? await ctx.db.get(leadId) : null;
  return lead && isNotDeleted(lead) && !profilingExcluded(lead) ? lead : null;
}

const visitorOf = (ctx: MutationCtx, visitorId: string) =>
  ctx.db
    .query('webVisitors')
    .withIndex('by_visitor', (q) => q.eq('visitorId', visitorId))
    .first();

/** The contact a tracked link's one-time value stands for; the value is spent whatever comes of it. */
async function redeemGrant(
  ctx: MutationCtx,
  grantHash: string,
  now: number,
): Promise<Id<'leads'> | undefined> {
  const token = await ctx.db
    .query('campaignLinkTokens')
    .withIndex('by_identifyHash', (q) => q.eq('identifyHash', grantHash))
    .first();
  if (!token) return undefined;
  await ctx.db.patch(token._id, { identifyHash: undefined, identifyUntil: undefined });
  return (token.identifyUntil ?? 0) > now ? token.leadId : undefined;
}

const scheduleAttach = (ctx: MutationCtx, visitorId: string, leadId: Id<'leads'>) =>
  ctx.scheduler.runAfter(0, internal.features.tracking.internal.attachViews, {
    visitorId,
    leadId,
  });

/** One beacon, already parsed by the route: an identified browser's views (named mode) go to its contact, the others wait. */
export const recordBeacon = internalMutation({
  args: {
    visitorId: v.string(),
    views: v.array(beaconViewValidator),
    grantHash: v.optional(v.string()),
  },
  returns: v.object({ stored: v.number() }),
  handler: async (ctx, args) => {
    const config = await loadTrackingConfig(ctx);
    if (!config.enabled || args.views.length === 0) return { stored: 0 };
    const now = Date.now();
    const visitor = await visitorOf(ctx, args.visitorId);
    const named = namedTracking(config);
    const granted = args.grantHash ? await redeemGrant(ctx, args.grantHash, now) : undefined;
    // A tracked link brought an unknown browser here: the link's contact is who is browsing.
    const identified = named && !visitor?.leadId && granted !== undefined;
    // A contact gone or objecting since, or the mode left: the browser is anonymous again.
    const lead = named ? await trackableLead(ctx, visitor?.leadId ?? granted) : null;
    const leadId = lead?._id;

    for (const view of args.views) {
      await ctx.db.insert('pageViews', { visitorId: args.visitorId, leadId, ...view });
    }
    // Views reach the contact in one write a minute at most, not one per view.
    const pending = leadId ? addMarks(visitor?.pending, marksOf(args.views)) : undefined;
    if (leadId && !visitor?.pending) {
      await ctx.scheduler.runAfter(FLUSH_MS, internal.features.tracking.internal.flushVisitor, {
        visitorId: args.visitorId,
      });
    }
    if (visitor) {
      await ctx.db.patch(visitor._id, {
        leadId,
        pending,
        lastSeenAt: Math.max(visitor.lastSeenAt, now),
        views: visitor.views + args.views.length,
      });
    } else {
      await ctx.db.insert('webVisitors', {
        visitorId: args.visitorId,
        leadId,
        pending,
        firstSeenAt: now,
        lastSeenAt: now,
        views: args.views.length,
      });
    }
    if (identified && leadId) await scheduleAttach(ctx, args.visitorId, leadId);
    return { stored: args.views.length };
  },
});

/** The views an identified browser sent since the last write, written on its contact. */
export const flushVisitor = internalMutation({
  args: { visitorId: v.string() },
  returns: v.null(),
  handler: async (ctx, { visitorId }) => {
    const visitor = await visitorOf(ctx, visitorId);
    if (!visitor?.pending) return null;
    await ctx.db.patch(visitor._id, { pending: undefined });
    if (visitor.leadId) await applyViewsToLead(ctx, visitor.leadId, visitor.pending);
    return null;
  },
});

/** A form submitted from this browser: in named mode its views join the contact, the earlier ones in batches. */
export const identifyVisitor = internalMutation({
  args: { visitorId: v.string(), leadId: v.id('leads') },
  returns: v.null(),
  handler: async (ctx, { visitorId, leadId }) => {
    const config = await loadTrackingConfig(ctx);
    if (!namedTracking(config) || !(await trackableLead(ctx, leadId))) return null;
    const visitor = await visitorOf(ctx, visitorId);
    if (visitor?.leadId === leadId) return null;
    const now = Date.now();
    if (visitor) {
      // What waited for another contact is that contact's.
      if (visitor.leadId && visitor.pending) {
        await applyViewsToLead(ctx, visitor.leadId, visitor.pending);
      }
      await ctx.db.patch(visitor._id, {
        leadId,
        pending: undefined,
        lastSeenAt: Math.max(visitor.lastSeenAt, now),
      });
    } else {
      await ctx.db.insert('webVisitors', {
        visitorId,
        leadId,
        firstSeenAt: now,
        lastSeenAt: now,
        views: 0,
      });
    }
    await scheduleAttach(ctx, visitorId, leadId);
    return null;
  },
});

/** One batch of a browser's anonymous views moved onto its contact, the contact marked once for the batch. */
export const attachViews = internalMutation({
  args: { visitorId: v.string(), leadId: v.id('leads') },
  returns: v.null(),
  handler: async (ctx, { visitorId, leadId }) => {
    const visitor = await visitorOf(ctx, visitorId);
    // The browser changed hands, the contact objected or went, the mode changed: nothing more is attached.
    if (visitor?.leadId !== leadId || !(await trackableLead(ctx, leadId))) return null;
    if (!namedTracking(await loadTrackingConfig(ctx))) return null;
    const rows = await ctx.db
      .query('pageViews')
      .withIndex('by_visitor_lead_at', (q) => q.eq('visitorId', visitorId).eq('leadId', undefined))
      .take(ATTACH_BATCH);
    if (rows.length === 0) return null;
    for (const row of rows) await ctx.db.patch(row._id, { leadId });
    // These views came before the contact was known: their paths go in front of the ones already there.
    await applyViewsToLead(ctx, leadId, marksOf(rows), true);
    // Until a pass finds nothing: a view that slipped in between two batches is swept too.
    await scheduleAttach(ctx, visitorId, leadId);
    return null;
  },
});

/** An objection's continuation: the contact's remaining browsers and views made anonymous, batch after batch. */
export const detachLead = internalMutation({
  args: { leadId: v.id('leads') },
  returns: v.null(),
  handler: async (ctx, { leadId }) => {
    if (await detachLeadTracking(ctx, leadId)) {
      await ctx.scheduler.runAfter(0, internal.features.tracking.internal.detachLead, { leadId });
    }
    return null;
  },
});

/** The mode left named: every browser and view goes back to anonymous and the contacts lose their marks, in batches. */
export const detachAll = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Back to named before the end: what is still attached stays.
    if ((await loadTrackingConfig(ctx)).mode === 'named') return null;
    const attached = '' as Id<'leads'>;
    const visitors = await ctx.db
      .query('webVisitors')
      .withIndex('by_lead', (q) => q.gt('leadId', attached))
      .take(ATTACH_BATCH);
    const views = await ctx.db
      .query('pageViews')
      .withIndex('by_lead_at', (q) => q.gt('leadId', attached))
      .take(ATTACH_BATCH);
    for (const row of visitors) {
      await ctx.db.patch(row._id, { leadId: undefined, pending: undefined });
    }
    for (const row of views) await ctx.db.patch(row._id, { leadId: undefined });
    // Every contact that carries marks, whether its views are still there or went with a purge or a merge.
    const marked = await ctx.db
      .query('leads')
      .withIndex('by_lastPageViewAt', (q) => q.gt('lastPageViewAt', 0))
      .take(ATTACH_BATCH);
    for (const lead of marked) await ctx.db.patch(lead._id, NO_VIEW_MARKS);
    const full = [visitors, views, marked].some((rows) => rows.length === ATTACH_BATCH);
    if (full) {
      await ctx.scheduler.runAfter(0, internal.features.tracking.internal.detachAll, {});
    }
    return null;
  },
});

/** After a purge: the marks of the contacts whose views went, rebuilt from the views that are left. */
export const refreshLeadViews = internalMutation({
  args: { leads: v.array(v.object({ leadId: v.id('leads'), removed: v.number() })) },
  returns: v.null(),
  handler: async (ctx, { leads }) => {
    for (const { leadId, removed } of leads) await refreshViewMarks(ctx, leadId, removed);
    return null;
  },
});

/** The deployment's ceiling refused views: the date is kept, once an hour at most, for the settings page. */
export const noteCeiling = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const config = await ctx.db.query('appConfig').first();
    if (!config?.tracking) return null;
    const now = Date.now();
    if ((config.tracking.ceilingHitAt ?? 0) >= now - CEILING_NOTE_MS) return null;
    await ctx.db.patch(config._id, { tracking: { ...config.tracking, ceilingHitAt: now } });
    return null;
  },
});
