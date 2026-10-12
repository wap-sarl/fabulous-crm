import type { HttpRouter } from 'convex/server';
import { internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import { hashClientIp } from '../../lib/forms/submission';
import { PUBLIC_CORS } from '../../lib/http/cors';
import { clientIpOf, enforceRateLimit } from '../../lib/security/rateLimits';

const consentJson = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS },
  });

const tokenOf = (request: Request): string | null => {
  const [token, extra] = new URL(request.url).pathname.slice('/consent/'.length).split('/');
  return token && extra === undefined ? token : null;
};

/** The preference centre writes here rather than through a mutation: the request carries the address, kept as a hash on each consent event. */
export function registerConsentRoutes(http: HttpRouter): void {
  http.route({
    pathPrefix: '/consent/',
    method: 'POST',
    handler: httpAction(async (ctx, request) => {
      const token = tokenOf(request);
      if (!token) return new Response('Not found', { status: 404 });
      if (!(await enforceRateLimit(ctx, 'consentTotal', 'all'))) {
        return consentJson({ ok: false, code: 'rate_limited' }, 429);
      }
      const body = (await request.json().catch(() => null)) as {
        types?: Record<string, unknown>;
        unsubscribeAll?: unknown;
      } | null;
      if (!body || typeof body !== 'object')
        return consentJson({ ok: false, code: 'invalid_body' }, 400);
      const types = Object.entries(body.types ?? {}).flatMap(([id, on]) =>
        typeof on === 'boolean' ? [{ id, status: on ? ('in' as const) : ('out' as const) }] : [],
      );
      const result = await ctx.runMutation(internal.features.consent.internal.applyConsentByToken, {
        token,
        types,
        unsubscribeAll: body.unsubscribeAll === true,
        ipHash: await hashClientIp(clientIpOf(request)),
      });
      if (!result.ok) {
        return consentJson(result, result.code === 'rate_limited' ? 429 : 404);
      }
      return consentJson(result, 200);
    }),
  });
  http.route({
    pathPrefix: '/consent/',
    method: 'OPTIONS',
    handler: httpAction(async () => new Response(null, { status: 204, headers: PUBLIC_CORS })),
  });
}
