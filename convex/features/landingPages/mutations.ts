import { v } from 'convex/values';
import { employeeMutation } from '../../_lib/auth';
import { refusal } from '../../_lib/refusal';
import {
  formOfPage,
  landingSectionValidator,
  landingSeoValidator,
  landingStatusValidator,
  landingTestValidator,
  landingVariantValidator,
  validateLandingPageShape,
  validatePublishable,
  validateTestShape,
} from '../../_lib/validators/landingPages';
import { createAuditFields, logAudit, updateAuditFields } from '../../lib/audit/log';
import { requireFormsOf, requireSlugFree } from '../../lib/landingPages/pages';
import { isNotDeleted } from '../../lib/shared/db';

const pageInput = {
  name: v.string(),
  slug: v.string(),
  seo: landingSeoValidator,
  sections: v.array(landingSectionValidator),
};

/** A page starts as a draft, from a template's sections or none; its slug must be free among the live pages. */
export const createLandingPage = employeeMutation({
  args: pageInput,
  returns: v.id('landingPages'),
  handler: async (ctx, args) => {
    const slug = args.slug.trim();
    const page = { ...args, name: args.name.trim(), slug };
    const shape = validateLandingPageShape(page);
    if (shape) throw refusal(shape);
    await requireSlugFree(ctx, slug);
    await requireFormsOf(ctx, args.sections);
    const pageId = await ctx.db.insert('landingPages', {
      ...page,
      status: 'draft',
      formId: formOfPage(args.sections),
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'landingPage',
      entityId: pageId,
      action: 'create',
      metadata: { name: page.name, slug },
    });
    return pageId;
  },
});

/** The content and the address of a page, published or not: a published page changes live. */
export const updateLandingPage = employeeMutation({
  args: { pageId: v.id('landingPages'), ...pageInput },
  returns: v.null(),
  handler: async (ctx, { pageId, ...args }) => {
    const existing = await ctx.db.get(pageId);
    if (!existing || !isNotDeleted(existing)) throw refusal('page_not_found');
    const slug = args.slug.trim();
    const page = { ...args, name: args.name.trim(), slug };
    const shape = validateLandingPageShape(page);
    if (shape) throw refusal(shape);
    if (existing.status === 'published') {
      const publishable = validatePublishable(page);
      if (publishable) throw refusal(publishable);
    }
    await requireSlugFree(ctx, slug, pageId);
    await requireFormsOf(ctx, args.sections);
    await ctx.db.patch(pageId, {
      ...page,
      formId: formOfPage(args.sections),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'landingPage',
      entityId: pageId,
      action: 'update',
      metadata: { name: page.name, slug, sections: page.sections.length },
    });
    return null;
  },
});

/** Published, a page answers at /p/<slug>; a draft answers nothing. Publishing needs something to show. */
export const setLandingPageStatus = employeeMutation({
  args: { pageId: v.id('landingPages'), status: landingStatusValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || !isNotDeleted(page)) throw refusal('page_not_found');
    if (page.status === args.status) return null;
    if (args.status === 'published') {
      const publishable = validatePublishable(page);
      if (publishable) throw refusal(publishable);
      await requireFormsOf(ctx, page.sections);
    }
    await ctx.db.patch(args.pageId, {
      status: args.status,
      publishedAt: args.status === 'published' ? Date.now() : page.publishedAt,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'landingPage',
      entityId: args.pageId,
      action: 'update',
      metadata: { status: args.status, slug: page.slug },
    });
    return null;
  },
});

/** Deleted, a page leaves its address free and answers nothing; its counters are kept with it. */
export const deleteLandingPage = employeeMutation({
  args: { pageId: v.id('landingPages') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || !isNotDeleted(page)) throw refusal('page_not_found');
    await ctx.db.patch(args.pageId, {
      status: 'draft',
      deletedAt: Date.now(),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'landingPage',
      entityId: args.pageId,
      action: 'delete',
      metadata: { name: page.name, slug: page.slug },
    });
    return null;
  },
});

/** An A/B test on a page: B's blocks and the share of visitors who see them, or null to stop the test and keep A. B follows the page's rules, and must be publishable when the page is published. */
export const setLandingPageTest = employeeMutation({
  args: { pageId: v.id('landingPages'), test: v.union(landingTestValidator, v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || !isNotDeleted(page)) throw refusal('page_not_found');
    if (args.test) {
      const shape = validateTestShape(page, args.test);
      if (shape) throw refusal(shape);
      if (page.status === 'published') {
        const publishable = validatePublishable({ ...page, sections: args.test.sections });
        if (publishable) throw refusal(publishable);
      }
      await requireFormsOf(ctx, args.test.sections);
    }
    await ctx.db.patch(args.pageId, {
      abTest: args.test ?? undefined,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'landingPage',
      entityId: args.pageId,
      action: 'update',
      metadata: args.test
        ? { test: 'set', share: args.test.share, sections: args.test.sections.length }
        : { test: 'stopped' },
    });
    return null;
  },
});

/** The test ends with the winner as the page: B's blocks take A's place when B wins, nothing moves when A does; the counters keep what each variant got. */
export const chooseLandingPageWinner = employeeMutation({
  args: { pageId: v.id('landingPages'), winner: landingVariantValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || !isNotDeleted(page)) throw refusal('page_not_found');
    if (!page.abTest) throw refusal('page_no_test');
    const sections = args.winner === 'b' ? page.abTest.sections : page.sections;
    await ctx.db.patch(args.pageId, {
      sections,
      formId: formOfPage(sections),
      abTest: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'landingPage',
      entityId: args.pageId,
      action: 'update',
      metadata: { test: 'won', winner: args.winner },
    });
    return null;
  },
});
