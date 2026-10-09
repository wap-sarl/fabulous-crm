import type { HttpRouter } from 'convex/server';
import { internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import { landingSlugSchema } from '../../_lib/validators/landingPages';
import { follows } from '../../_lib/validators/fields';
import { NOT_FOUND_HTML } from '../../lib/landingPages/render';
import { clientIpOf, enforceRateLimit } from '../../lib/security/rateLimits';

// The page loads nothing but the deployment's own scripts, which style what they add inline; images may come from anywhere over https.
const PAGE_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const html = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PAGE_CSP,
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
      const [slug, extra] = url.pathname.slice('/p/'.length).split('/');
      if (!slug || extra !== undefined || !follows(landingSlugSchema, slug)) {
        return html(NOT_FOUND_HTML, 404);
      }
      if (!(await enforceRateLimit(ctx, 'pageRender', clientIpOf(request)))) {
        return new Response('Too many requests', { status: 429 });
      }
      const page = await ctx.runQuery(internal.features.landingPages.internal.getPublishedPage, {
        slug,
      });
      if (!page) return html(NOT_FOUND_HTML, 404);
      if (!BOT_RE.test(request.headers.get('user-agent') ?? '')) {
        await ctx.runMutation(internal.features.landingPages.internal.recordPageView, {
          pageId: page.pageId,
        });
      }
      return html(page.html, 200);
    }),
  });
}
