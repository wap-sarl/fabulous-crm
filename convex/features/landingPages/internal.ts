import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { internalMutation } from '../../_lib/functions';
import { pageBySlug, renderContextOf } from '../../lib/landingPages/pages';
import { renderLandingPage } from '../../lib/landingPages/render';
import { countForPage } from '../../lib/landingPages/stats';

/** The document of the published page at a slug and the origin its policy names, null for a draft or none: nothing says which drafts exist. */
export const getPublishedPage = internalQuery({
  args: { slug: v.string() },
  returns: v.union(
    v.object({ pageId: v.id('landingPages'), html: v.string(), base: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const page = await pageBySlug(ctx, args.slug);
    if (page?.status !== 'published') return null;
    const context = await renderContextOf(ctx, page.sections);
    return { pageId: page._id, html: renderLandingPage(page, context), base: context.base };
  },
});

/** A visitor opened the page: one view, cookieless. */
export const recordPageView = internalMutation({
  args: { pageId: v.id('landingPages') },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.pageId)) await countForPage(ctx, args.pageId, 'views');
    return null;
  },
});
