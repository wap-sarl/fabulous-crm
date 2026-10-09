import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';
import { internalMutation } from '../../_lib/functions';
import { landingVariantValidator, variantFor } from '../../_lib/validators/landingPages';
import { pageById, pageBySlug, renderContextOf } from '../../lib/landingPages/pages';
import { renderLandingPage, sectionsOf } from '../../lib/landingPages/render';
import { countForPage } from '../../lib/landingPages/stats';

/** The document of the published page at a slug for the visitor's bucket (0–99, the same at every visit), the variant it is, and the origin its policy names; null for a draft or none: nothing says which drafts exist. */
export const getPublishedPage = internalQuery({
  args: { slug: v.string(), bucket: v.number() },
  returns: v.union(
    v.object({
      pageId: v.id('landingPages'),
      html: v.string(),
      base: v.string(),
      variant: landingVariantValidator,
      test: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const page = await pageBySlug(ctx, args.slug);
    if (page?.status !== 'published') return null;
    const variant = variantFor(page.abTest, args.bucket);
    const context = await renderContextOf(ctx, sectionsOf(page, variant));
    return {
      pageId: page._id,
      html: renderLandingPage(page, { ...context, variant }),
      base: context.base,
      variant,
      test: page.abTest?.id,
    };
  },
});

/** The slug of the live page an id names, what a visitor's bucket is drawn on; null for none: the submit route asks before drawing. */
export const getPageSlug = internalQuery({
  args: { page: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => (await pageById(ctx, args.page))?.slug ?? null,
});

/** A visitor opened the page: one view, cookieless, on the variant shown. */
export const recordPageView = internalMutation({
  args: {
    pageId: v.id('landingPages'),
    variant: landingVariantValidator,
    test: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.pageId)) {
      await countForPage(ctx, args.pageId, 'views', args.variant, args.test);
    }
    return null;
  },
});
