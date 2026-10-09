import type { HttpRouter } from 'convex/server';
import { internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import { landingSlugSchema } from '../../_lib/validators/landingPages';
import { follows } from '../../_lib/validators/fields';
import { NOT_FOUND_HTML, pagePolicy } from '../../lib/landingPages/render';
import { clientIpOf, enforceRateLimit } from '../../lib/security/rateLimits';

// The document's own policy, plus what only a header can say: nobody frames the page.
const html = (body: string, status: number, base: string) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `${pagePolicy(base)}; frame-ancestors 'none'`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': status === 200 ? 'all' : 'noindex',
    },
  });

/** A crawler's visit is not a view. */
const BOT_RE = /bot|crawl|spider|slurp|preview|fetch|facebookexternalhit|whatsapp|telegram/i;

export function registerLandingPagesRoutes(http: HttpRouter): void {
  // The public face of a hosted page: /p/<slug>, published pages only.
  http.route({
    pathPrefix: '/p/',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      // The header names the origin the document does, the deployment's as configured, not the one this request came through.
      const base = process.env.CONVEX_SITE_URL ?? url.origin;
      const [slug, extra] = url.pathname.slice('/p/'.length).split('/');
      if (!slug || extra !== undefined || !follows(landingSlugSchema, slug)) {
        return html(NOT_FOUND_HTML, 404, base);
      }
      if (!(await enforceRateLimit(ctx, 'pageRender', clientIpOf(request)))) {
        return new Response('Too many requests', { status: 429 });
      }
      const page = await ctx.runQuery(internal.features.landingPages.internal.getPublishedPage, {
        slug,
      });
      if (!page) return html(NOT_FOUND_HTML, 404, base);
      // Past the deployment's ceiling the page is still served; the view is not counted, so a flood costs bandwidth and nothing else.
      if (
        !BOT_RE.test(request.headers.get('user-agent') ?? '') &&
        (await enforceRateLimit(ctx, 'pageRenderTotal', 'all'))
      ) {
        await ctx.runMutation(internal.features.landingPages.internal.recordPageView, {
          pageId: page.pageId,
        });
      }
      return html(page.html, 200, page.base);
    }),
  });
}
