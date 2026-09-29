import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  ATTACH_BATCH,
  REFRESH_LEADS,
  REFRESH_SCAN,
  type ViewMarks,
  VISITED_PAGES_MAX,
  VISITED_PATH_MAX,
} from '../../_lib/validators/tracking';
import { isNotDeleted } from '../shared/db';
import { profilingExcluded } from '../leads/signals';

/** The contact's visited paths with these added: distinct, in the order of the last visits, bounded. */
function mergeVisitedPages(
  current: string[] | undefined,
  paths: string[],
  earlier = false,
): string[] {
  const cut = paths.map((p) => p.slice(0, VISITED_PATH_MAX));
  // Views from before the ones already there (the attach job's) go in front.
  const ordered = earlier ? [...cut, ...(current ?? [])] : [...(current ?? []), ...cut];
  return ordered.filter((p, i) => ordered.lastIndexOf(p) === i).slice(-VISITED_PAGES_MAX);
}

/** What a set of views leaves on a contact: how many, the last date, the paths in browsing order. */
export function marksOf(views: { path: string; at: number }[]): ViewMarks {
  const ordered = [...views].sort((a, b) => a.at - b.at);
  return {
    count: views.length,
    latest: ordered.length ? ordered[ordered.length - 1].at : 0,
    paths: mergeVisitedPages(
      [],
      ordered.map((v) => v.path),
    ),
  };
}

export function addMarks(a: ViewMarks | undefined, b: ViewMarks): ViewMarks {
  if (!a) return b;
  return {
    count: a.count + b.count,
    latest: Math.max(a.latest, b.latest),
    paths: mergeVisitedPages(a.paths, b.paths),
  };
}

/** The behavioural marks of a contact without tracking: none. */
export const NO_VIEW_MARKS = {
  pageViewCount: undefined,
  lastPageViewAt: undefined,
  visitedPages: undefined,
} as const;

export const hasViewMarks = (lead: Doc<'leads'>): boolean =>
  lead.pageViewCount !== undefined ||
  lead.lastPageViewAt !== undefined ||
  lead.visitedPages !== undefined;

/** Writes views' marks on a contact; one who objected to profiling only has the activity date moved. */
export async function applyViewsToLead(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  marks: ViewMarks,
  earlier = false,
): Promise<void> {
  if (marks.count === 0) return;
  const lead = await ctx.db.get(leadId);
  if (!lead || !isNotDeleted(lead)) return;
  const patch: Partial<Doc<'leads'>> = {};
  if ((lead.lastActivityAt ?? 0) < marks.latest) patch.lastActivityAt = marks.latest;
  if (!profilingExcluded(lead)) {
    patch.pageViewCount = (lead.pageViewCount ?? 0) + marks.count;
    if ((lead.lastPageViewAt ?? 0) < marks.latest) patch.lastPageViewAt = marks.latest;
    patch.visitedPages = mergeVisitedPages(lead.visitedPages, marks.paths, earlier);
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(leadId, patch);
}

/** Two contacts' marks as one, for a merge: the counts added, the paths of the last visitor last. */
export function mergedViewMarks(
  survivor: Doc<'leads'>,
  absorbed: Doc<'leads'>,
): Partial<Pick<Doc<'leads'>, 'pageViewCount' | 'lastPageViewAt' | 'visitedPages'>> {
  if (!hasViewMarks(absorbed)) return {};
  const absorbedLast = (absorbed.lastPageViewAt ?? 0) > (survivor.lastPageViewAt ?? 0);
  return {
    pageViewCount: (survivor.pageViewCount ?? 0) + (absorbed.pageViewCount ?? 0),
    lastPageViewAt: Math.max(survivor.lastPageViewAt ?? 0, absorbed.lastPageViewAt ?? 0),
    visitedPages: mergeVisitedPages(
      survivor.visitedPages,
      absorbed.visitedPages ?? [],
      !absorbedLast,
    ),
  };
}

/** One batch of a contact's browsers and views made anonymous again; true while some are left. */
export async function detachLeadTracking(ctx: MutationCtx, leadId: Id<'leads'>): Promise<boolean> {
  const visitors = await ctx.db
    .query('webVisitors')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(ATTACH_BATCH);
  for (const row of visitors)
    await ctx.db.patch(row._id, { leadId: undefined, pending: undefined });
  const views = await ctx.db
    .query('pageViews')
    .withIndex('by_lead_at', (q) => q.eq('leadId', leadId))
    .take(ATTACH_BATCH);
  for (const row of views) await ctx.db.patch(row._id, { leadId: undefined });
  return visitors.length === ATTACH_BATCH || views.length === ATTACH_BATCH;
}

/** A contact stops being tracked (an objection): the marks go now, the browsers and views in batches. */
export async function stopLeadTracking(ctx: MutationCtx, leadId: Id<'leads'>): Promise<void> {
  if (await detachLeadTracking(ctx, leadId)) {
    await ctx.scheduler.runAfter(0, internal.features.tracking.internal.detachLead, { leadId });
  }
}

/** The purge removed these views: their contacts' marks are rebuilt from what is left, a few contacts per step. */
export async function scheduleViewRefresh(
  ctx: MutationCtx,
  rows: { leadId?: Id<'leads'> }[],
): Promise<void> {
  const removed = new Map<Id<'leads'>, number>();
  for (const row of rows) {
    if (row.leadId) removed.set(row.leadId, (removed.get(row.leadId) ?? 0) + 1);
  }
  const leads = [...removed].map(([leadId, count]) => ({ leadId, removed: count }));
  for (let i = 0; i < leads.length; i += REFRESH_LEADS) {
    await ctx.scheduler.runAfter(0, internal.features.tracking.internal.refreshLeadViews, {
      leads: leads.slice(i, i + REFRESH_LEADS),
    });
  }
}

/** A contact's marks after a purge: the paths of the views that survive, the count less what went. */
export async function refreshViewMarks(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  removed: number,
): Promise<void> {
  const lead = await ctx.db.get(leadId);
  if (!lead || !isNotDeleted(lead) || !hasViewMarks(lead)) return;
  const rows = await ctx.db
    .query('pageViews')
    .withIndex('by_lead_at', (q) => q.eq('leadId', leadId))
    .order('desc')
    .take(REFRESH_SCAN);
  if (rows.length === 0) {
    await ctx.db.patch(leadId, NO_VIEW_MARKS);
    return;
  }
  await ctx.db.patch(leadId, {
    pageViewCount: Math.max(0, (lead.pageViewCount ?? 0) - removed),
    lastPageViewAt: rows[0].at,
    visitedPages: mergeVisitedPages(
      [],
      rows.reverse().map((r) => r.path),
    ),
  });
}
