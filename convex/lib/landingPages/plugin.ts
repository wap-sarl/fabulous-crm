import type { QueryCtx } from '../../_generated/server';

/** Whether live pages exist: what keeps the plugin installed on a deployment from before the catalogue. */
export async function landingPagesHaveData(ctx: Pick<QueryCtx, 'db'>): Promise<boolean> {
  const page = await ctx.db
    .query('landingPages')
    .withIndex('by_deletedAt', (q) => q.eq('deletedAt', undefined))
    .first();
  return page !== null;
}

/** The addresses of the published pages, up to `limit` and one more to say there are more: what an uninstall closes. */
export async function publishedPageUrls(
  ctx: Pick<QueryCtx, 'db'>,
  limit: number,
): Promise<string[]> {
  const pages = await ctx.db
    .query('landingPages')
    .withIndex('by_deletedAt', (q) => q.eq('deletedAt', undefined))
    .filter((q) => q.eq(q.field('status'), 'published'))
    .take(limit + 1);
  const base = process.env.CONVEX_SITE_URL ?? '';
  return pages.map((page) => `${base}/p/${page.slug}`);
}
