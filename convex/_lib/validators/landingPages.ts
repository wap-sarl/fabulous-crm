import { type Infer, v } from 'convex/values';
import { z } from 'zod';
import { follows, httpUrlSchema } from './fields';
import { logsValidator, softDeleteValidator } from './shared';

export const MAX_PAGE_SECTIONS = 20;
export const MAX_SEO_TITLE = 70;
export const MAX_SEO_DESCRIPTION = 160;

/** The address of a page under /p/: lower-case letters, digits and hyphens, 60 characters at most. */
export const landingSlugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

/** What a button leads to: an address, or the page's own form. */
const ctaHrefSchema = z.union([httpUrlSchema, z.literal('#form')]);

const sectionBase = { id: v.string() };

/** The blocks a page is built from, in order; a text block holds the editor's HTML, as a campaign does. */
export const landingSectionValidator = v.union(
  v.object({
    ...sectionBase,
    type: v.literal('hero'),
    heading: v.string(),
    text: v.optional(v.string()),
    ctaLabel: v.optional(v.string()),
    ctaHref: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  }),
  v.object({ ...sectionBase, type: v.literal('text'), html: v.string() }),
  v.object({
    ...sectionBase,
    type: v.literal('image'),
    url: v.string(),
    alt: v.string(),
    caption: v.optional(v.string()),
  }),
  v.object({
    ...sectionBase,
    type: v.literal('form'),
    formId: v.id('forms'),
    heading: v.optional(v.string()),
  }),
  v.object({
    ...sectionBase,
    type: v.literal('cta'),
    heading: v.string(),
    text: v.optional(v.string()),
    label: v.string(),
    href: v.string(),
  }),
);

export const landingSeoValidator = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  // The image social networks show for the link.
  imageUrl: v.optional(v.string()),
});

export const landingStatusValidator = v.union(v.literal('draft'), v.literal('published'));

export const landingPageValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  name: v.string(),
  slug: v.string(),
  status: landingStatusValidator,
  publishedAt: v.optional(v.number()),
  seo: landingSeoValidator,
  sections: v.array(landingSectionValidator),
  // The form of the first form block, for the list and the submissions that come from the page.
  formId: v.optional(v.id('forms')),
});

/** The views and the submissions of a page, by UTC day, spread over rows so that a burst of visitors does not meet on one document. */
export const landingPageStatsValidator = v.object({
  pageId: v.id('landingPages'),
  day: v.string(),
  shard: v.number(),
  views: v.number(),
  submissions: v.number(),
});

export type LandingSection = Infer<typeof landingSectionValidator>;
export type LandingSeo = Infer<typeof landingSeoValidator>;

/** What the editor sends: the page as it is kept, less what the server sets. */
export interface LandingPageInput {
  name: string;
  slug: string;
  seo: LandingSeo;
  sections: LandingSection[];
}

const text = (value: string | undefined) => (value ?? '').trim();

/** Structural checks only: whether a form exists needs the db, so the mutations check it. */
export function validateLandingPageShape(page: LandingPageInput): string | null {
  if (!page.name.trim()) return 'page_name_required';
  if (!follows(landingSlugSchema, page.slug)) return 'page_invalid_slug';
  if (!page.seo.title.trim()) return 'page_title_required';
  if (page.seo.title.length > MAX_SEO_TITLE) return 'page_title_too_long';
  if ((page.seo.description ?? '').length > MAX_SEO_DESCRIPTION) return 'page_description_too_long';
  if (page.seo.imageUrl && !follows(httpUrlSchema, page.seo.imageUrl)) return 'page_invalid_url';
  if (page.sections.length > MAX_PAGE_SECTIONS) return 'page_too_many_sections';
  const ids = new Set<string>();
  for (const section of page.sections) {
    if (!section.id || ids.has(section.id)) return 'page_duplicate_section';
    ids.add(section.id);
    switch (section.type) {
      case 'hero':
        if (!text(section.heading)) return 'page_heading_required';
        if (text(section.ctaLabel) && !follows(ctaHrefSchema, text(section.ctaHref)))
          return 'page_invalid_url';
        if (section.imageUrl && !follows(httpUrlSchema, section.imageUrl))
          return 'page_invalid_url';
        break;
      case 'text':
        if (!text(section.html)) return 'page_text_required';
        break;
      case 'image':
        if (!follows(httpUrlSchema, section.url)) return 'page_invalid_url';
        break;
      case 'cta':
        if (!text(section.heading)) return 'page_heading_required';
        if (!text(section.label)) return 'page_label_required';
        if (!follows(ctaHrefSchema, text(section.href))) return 'page_invalid_url';
        break;
      case 'form':
        break;
    }
  }
  return null;
}

/** A published page needs something to show, and a `#form` button needs a form block to lead to. */
export function validatePublishable(page: LandingPageInput): string | null {
  if (page.sections.length === 0) return 'page_sections_required';
  const hasForm = page.sections.some((section) => section.type === 'form');
  const leadsToForm = page.sections.some(
    (section) =>
      (section.type === 'hero' && text(section.ctaHref) === '#form') ||
      (section.type === 'cta' && text(section.href) === '#form'),
  );
  if (leadsToForm && !hasForm) return 'page_form_required';
  return null;
}

/** The form a page's submissions are attributed to: that of its first form block. */
export function formOfPage(sections: LandingSection[]) {
  for (const section of sections) if (section.type === 'form') return section.formId;
  return undefined;
}
