import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import type { LandingSection, LandingVariant } from '../../_lib/validators/landingPages';
import { sha256Base64Url } from '../security/crypto';
import { isNotDeleted } from '../shared/db';
import { loadTrackingConfig } from '../tracking/config';

/** The live page at a slug, published or not: a deleted one has left its address. */
export async function pageBySlug(
  ctx: Pick<QueryCtx, 'db'>,
  slug: string,
): Promise<Doc<'landingPages'> | null> {
  const page = await ctx.db
    .query('landingPages')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .filter((q) => q.eq(q.field('deletedAt'), undefined))
    .first();
  return page;
}

/** A slug names one live page: another's is refused. */
export async function requireSlugFree(
  ctx: Pick<QueryCtx, 'db'>,
  slug: string,
  self?: Id<'landingPages'>,
): Promise<void> {
  const other = await pageBySlug(ctx, slug);
  if (other && other._id !== self) throw refusal('page_slug_taken');
}

/** The forms a page's blocks name must exist and be live. */
export async function requireFormsOf(
  ctx: Pick<MutationCtx, 'db'>,
  sections: LandingSection[],
): Promise<void> {
  for (const section of sections) {
    if (section.type !== 'form') continue;
    const form = await ctx.db.get(section.formId);
    if (!form || !isNotDeleted(form)) throw refusal('page_form_unknown');
  }
}

/** The forms of a page that can be shown: active and live. */
async function liveFormIdsOf(
  ctx: Pick<QueryCtx, 'db'>,
  sections: LandingSection[],
): Promise<Set<string>> {
  const live = new Set<string>();
  for (const section of sections) {
    if (section.type !== 'form') continue;
    const form = await ctx.db.get(section.formId);
    if (form && isNotDeleted(form) && form.active) live.add(form._id);
  }
  return live;
}

/** What rendering a page needs besides the page: the deployment's origin, the forms it can show, whether it is tracked. */
export async function renderContextOf(ctx: QueryCtx | MutationCtx, sections: LandingSection[]) {
  return {
    base: process.env.CONVEX_SITE_URL ?? '',
    liveFormIds: await liveFormIdsOf(ctx, sections),
    tracking: (await loadTrackingConfig(ctx)).enabled,
  };
}

/** The page and the variant a submission came from, when the embed names a page that is published and holds the form on that variant; B only while the test runs. */
export async function pageOfSubmission(
  ctx: Pick<MutationCtx, 'db'>,
  formId: Id<'forms'>,
  raw: string | undefined,
  rawVariant: string | undefined,
): Promise<{ pageId: Id<'landingPages'>; variant: LandingVariant } | undefined> {
  const pageId = raw ? ctx.db.normalizeId('landingPages', raw) : null;
  const page = pageId ? await ctx.db.get(pageId) : null;
  if (!page || !isNotDeleted(page) || page.status !== 'published') return undefined;
  const variant: LandingVariant = rawVariant === 'b' && page.abTest ? 'b' : 'a';
  const sections = variant === 'b' && page.abTest ? page.abTest.sections : page.sections;
  return sections.some((section) => section.type === 'form' && section.formId === formId)
    ? { pageId: page._id, variant }
    : undefined;
}

/** Where a visitor falls among a hundred, the same at every visit of the page from the same address and browser, nothing stored: what decides the variant they see. */
export async function visitorBucket(slug: string, ip: string, userAgent: string): Promise<number> {
  const hash = await sha256Base64Url(`${slug}:${ip}:${userAgent}`);
  let n = 0;
  for (const char of hash.slice(0, 8)) n = (n * 31 + char.charCodeAt(0)) % 100;
  return n;
}
