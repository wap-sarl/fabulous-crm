import type { HttpRouter } from 'convex/server';
import { httpAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { FORM_EMBED_JS, formIframeHtml } from '../../lib/forms/embed';
import { hashClientIp } from '../../lib/forms/submission';
import { VISITOR_ID_RE } from '../../_lib/validators/tracking';
import { clientIpOf, enforceRateLimit } from '../../lib/security/rateLimits';
import { visitorBucket } from '../../lib/landingPages/pages';
import { PUBLIC_CORS } from '../../lib/http/cors';

const formJson = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS },
  });

export function registerFormsRoutes(http: HttpRouter): void {
  // The public capture-form surface: the page for an iframe, the script for an external page, and the definition the two render.
  http.route({
    pathPrefix: '/forms/',
    method: 'GET',
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      const [formId, rest, extra] = url.pathname.slice('/forms/'.length).split('/');
      if (!formId || extra !== undefined) return new Response('Not found', { status: 404 });

      if (rest === undefined) {
        return new Response(formIframeHtml(formId), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // The page loads its own script and posts to its own origin; styles are set from the script.
            'Content-Security-Policy':
              "default-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *",
          },
        });
      }
      if (rest === 'embed.js') {
        return new Response(FORM_EMBED_JS, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
            ...PUBLIC_CORS,
          },
        });
      }
      if (rest === 'def') {
        if (!(await enforceRateLimit(ctx, 'formRender', clientIpOf(request)))) {
          return formJson({ error: 'rate_limited' }, 429);
        }
        const def = await ctx.runQuery(internal.features.forms.internal.getPublicForm, {
          formId,
          visitorToken: url.searchParams.get('visitor') ?? undefined,
        });
        if (!def) return formJson({ error: 'not_found' }, 404);
        return formJson(def, 200);
      }
      return new Response('Not found', { status: 404 });
    }),
  });

  http.route({
    pathPrefix: '/forms/',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      const [formId, rest, extra] = url.pathname.slice('/forms/'.length).split('/');
      if (!formId || rest !== 'submit' || extra !== undefined) {
        return new Response('Not found', { status: 404 });
      }
      const ip = clientIpOf(request);
      if (
        !(await enforceRateLimit(ctx, 'formSubmit', ip)) ||
        !(await enforceRateLimit(ctx, 'formSubmitPerForm', formId)) ||
        !(await enforceRateLimit(ctx, 'formSubmitTotal', 'all'))
      ) {
        return formJson({ ok: false, code: 'rate_limited' }, 429);
      }
      const body = (await request.json().catch(() => null)) as {
        values?: Record<string, unknown>;
        consent?: boolean;
        honeypot?: string;
        renderedAt?: number;
        renderSig?: string;
        visitorToken?: string;
        trackingVisitor?: string;
        page?: string;
      } | null;
      if (!body || typeof body.values !== 'object' || body.values === null) {
        return formJson({ ok: false, code: 'invalid_body' }, 400);
      }
      const userAgent = request.headers.get('user-agent') ?? undefined;
      const page = typeof body.page === 'string' ? body.page : undefined;
      // The bucket is drawn here, where the address is: the mutation gets a number, and no argument of it holds the address.
      const slug =
        page === undefined
          ? null
          : await ctx.runQuery(internal.features.landingPages.internal.getPageSlug, { page });
      const result = await ctx.runMutation(internal.features.forms.internal.submitForm, {
        formId,
        values: Object.fromEntries(
          Object.entries(body.values).filter(
            ([, value]) =>
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean' ||
              (Array.isArray(value) && value.every((item) => typeof item === 'string')),
          ),
        ) as Record<string, string | number | boolean | string[]>,
        consent: body.consent === true,
        honeypot: typeof body.honeypot === 'string' ? body.honeypot : undefined,
        renderedAt: typeof body.renderedAt === 'number' ? body.renderedAt : undefined,
        renderSig: typeof body.renderSig === 'string' ? body.renderSig : undefined,
        trackingVisitor:
          typeof body.trackingVisitor === 'string' && VISITOR_ID_RE.test(body.trackingVisitor)
            ? body.trackingVisitor
            : undefined,
        visitorToken: typeof body.visitorToken === 'string' ? body.visitorToken : undefined,
        page,
        bucket: slug === null ? undefined : await visitorBucket(slug, ip, userAgent ?? ''),
        ipHash: await hashClientIp(ip),
        userAgent,
      });
      if (!result.ok) return formJson(result, result.code === 'not_found' ? 404 : 400);
      return formJson(result, 200);
    }),
  });

  // Cross-origin preflight for the JSON submit POST.
  http.route({
    pathPrefix: '/forms/',
    method: 'OPTIONS',
    handler: httpAction(async () => new Response(null, { status: 204, headers: PUBLIC_CORS })),
  });
}
