import { v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';
import { landingStatusValidator } from '../../_lib/validators/landingPages';
import { renderContextOf } from '../../lib/landingPages/pages';
import { renderLandingPage } from '../../lib/landingPages/render';
import { statsOfPage } from '../../lib/landingPages/stats';
import { docOf } from '../../lib/shared/docs';
import { isNotDeleted } from '../../lib/shared/db';

const STATS_DAYS = 30;

/** The pages people built, newest first, with the last thirty days' counters: few rows. */
export const listLandingPages = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('landingPages'),
      name: v.string(),
      slug: v.string(),
      status: landingStatusValidator,
      updatedAt: v.number(),
      views: v.number(),
      submissions: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const pages = await ctx.db
      .query('landingPages')
      .withIndex('by_deletedAt', (q) => q.eq('deletedAt', undefined))
      .order('desc')
      .collect();
    const rows = [];
    for (const page of pages) {
      const stats = await statsOfPage(ctx, page._id, STATS_DAYS);
      rows.push({
        _id: page._id,
        name: page.name,
        slug: page.slug,
        status: page.status,
        updatedAt: page.updatedAt,
        views: stats.views,
        submissions: stats.submissions,
      });
    }
    return rows;
  },
});

/** One page as the editor loads it, with the address it answers at. */
export const getLandingPage = employeeQuery({
  args: { pageId: v.id('landingPages') },
  returns: v.union(v.object({ page: docOf('landingPages'), url: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || !isNotDeleted(page)) return null;
    return { page, url: `${process.env.CONVEX_SITE_URL ?? ''}/p/${page.slug}` };
  },
});

/** The counters of a page by day over the last thirty days, and their totals. */
export const getLandingPageStats = employeeQuery({
  args: { pageId: v.id('landingPages') },
  returns: v.union(
    v.object({
      days: v.array(v.object({ day: v.string(), views: v.number(), submissions: v.number() })),
      views: v.number(),
      submissions: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || !isNotDeleted(page)) return null;
    return await statsOfPage(ctx, args.pageId, STATS_DAYS);
  },
});

/** The page as the public route would serve it now, draft included, for the editor's preview; the form is drawn, not run. */
export const previewLandingPage = employeeQuery({
  args: { pageId: v.id('landingPages') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || !isNotDeleted(page)) return null;
    return renderLandingPage(page, {
      ...(await renderContextOf(ctx, page.sections)),
      preview: true,
    });
  },
});
