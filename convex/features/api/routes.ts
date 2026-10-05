import type { HttpRouter } from 'convex/server';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import { httpAction, type ActionCtx } from '../../_generated/server';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '../../_lib/validators/apiKeys';
import {
  API_KEY_TOUCH_INTERVAL_MS,
  apiKeyAccepts,
  hasScope,
  parseApiBearer,
} from '../../lib/api/auth';
import { extensions } from '../../extensions';
import { isApiError } from '../../lib/api/errors';
import { openapiDocument } from '../../lib/api/openapi.generated';
import { checkRateLimit, clientIpOf, consumeRateLimit } from '../../lib/security/rateLimits';
import {
  METHODS,
  type Method,
  type ApiResult,
  type ApiRequest,
  type ApiRoute,
  errorResult,
  toResponse,
  rateLimited,
  isCursorError,
} from '../../lib/api/http';
import { ROUTES } from '../../lib/api/routeTable';

const API_PREFIX = '/api/v1/';

const q = internal.features.api.internal;

const literalCount = (pattern: string) =>
  pattern.split('/').filter((s) => !s.startsWith(':')).length;

/** Literal segments must match; `:name` segments capture. Most literal segments first. */
function matchRoute(
  method: Method,
  segments: string[],
): { route: ApiRoute; params: Record<string, string> } | null {
  const candidates = ROUTES.filter((r) => r.method === method).sort(
    (a, b) => literalCount(b.pattern) - literalCount(a.pattern),
  );
  for (const route of candidates) {
    const parts = route.pattern.split('/');
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = segments[i];
      else if (parts[i] !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

// The wrapper

async function authenticate(
  ctx: ActionCtx,
  request: Request,
): Promise<{ key: Doc<'apiKeys'> } | { response: Response }> {
  const ip = clientIpOf(request);
  const failed = async (): Promise<{ response: Response }> => {
    const fail = await consumeRateLimit(ctx, 'apiAuthFail', ip);
    if (!fail.ok) return { response: rateLimited(fail.retryAfterMs) };
    return { response: toResponse(errorResult(401, 'unauthorized', 'Invalid API key.')) };
  };

  // A rate-limited IP is refused before any key lookup: no DB work for a brute force.
  const budget = await checkRateLimit(ctx, 'apiAuthFail', ip);
  if (!budget.ok) return { response: rateLimited(budget.retryAfterMs) };
  const parsed = parseApiBearer(request.headers.get('authorization'));
  if (!parsed) return failed();
  const key = await ctx.runQuery(q.getApiKeyByKeyId, { keyId: parsed.keyId });
  if (!key || !(await apiKeyAccepts(key, parsed.secret))) return failed();
  return { key };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Run the handler, turning every failure into the API error shape. */
async function runHandler(ctx: ActionCtx, route: ApiRoute, req: ApiRequest): Promise<ApiResult> {
  try {
    return await route.handler(ctx, req);
  } catch (error) {
    if (isApiError(error)) {
      const { status, code, message, details } = error.data;
      return errorResult(status, code, message, details);
    }
    if (isCursorError(error, req)) return errorResult(400, 'invalid_cursor', 'Invalid cursor.');
    console.error('api_internal_error', { method: route.method, pattern: route.pattern, error });
    return errorResult(500, 'internal_error', 'Internal error.');
  }
}

async function handle(ctx: ActionCtx, request: Request, method: Method): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname
    .slice(API_PREFIX.length)
    .split('/')
    .filter((s) => s !== '');

  const auth = await authenticate(ctx, request);
  if ('response' in auth) return auth.response;
  const { key } = auth;

  const budget = await consumeRateLimit(ctx, 'apiRequest', key.keyId);
  if (!budget.ok) return rateLimited(budget.retryAfterMs);
  if (method !== 'GET') {
    const writes = await consumeRateLimit(ctx, 'apiWrite', key.keyId);
    if (!writes.ok) return rateLimited(writes.retryAfterMs);
  }
  const refusal = await extensions.beforeApiRequest(ctx, key, method);
  if (refusal) {
    return toResponse(errorResult(refusal.status, refusal.code, refusal.message, refusal.details));
  }
  if (key.lastUsedAt === undefined || Date.now() - key.lastUsedAt >= API_KEY_TOUCH_INTERVAL_MS) {
    await ctx.runMutation(q.touchApiKey, { id: key._id });
  }

  const match = matchRoute(method, segments);
  if (!match) return toResponse(errorResult(404, 'not_found', 'Unknown resource.'));
  const { route, params } = match;
  const missing = [route.scope ?? []].flat().find((scope) => !hasScope(key, scope));
  if (missing) {
    return toResponse(errorResult(403, 'missing_scope', `This key lacks the ${missing} scope.`));
  }

  let body: unknown;
  let rawBody = '';
  if (method === 'POST' || method === 'PATCH') {
    rawBody = await request.text();
    try {
      body = rawBody.trim() === '' ? {} : JSON.parse(rawBody);
    } catch {
      return toResponse(errorResult(400, 'invalid_json', 'The request body is not valid JSON.'));
    }
  }
  const req: ApiRequest = { key, url, params, body };

  // Idempotency-Key: a retried POST replays the first answer instead of writing twice.
  const idempotencyKey = method === 'POST' ? request.headers.get('idempotency-key') : null;
  if (idempotencyKey === null) return toResponse(await runHandler(ctx, route, req));
  if (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return toResponse(
      errorResult(
        400,
        'invalid_idempotency_key',
        `Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      ),
    );
  }
  const fingerprint = await sha256Hex(`${method}\n${url.pathname}\n${rawBody}`);
  const reservation = await ctx.runMutation(q.beginIdempotentRequest, {
    apiKeyId: key._id,
    key: idempotencyKey,
    fingerprint,
  });
  switch (reservation.kind) {
    case 'replay':
      return new Response(reservation.body, {
        status: reservation.status,
        headers: { 'Content-Type': 'application/json', 'Idempotent-Replayed': 'true' },
      });
    case 'mismatch':
      return toResponse(
        errorResult(
          422,
          'idempotency_key_reused',
          'This Idempotency-Key was already used for a different request.',
        ),
      );
    case 'pending':
      return toResponse(
        errorResult(409, 'idempotency_in_progress', 'A request with this key is still running.'),
      );
  }
  const result = await runHandler(ctx, route, req);
  if (result.status < 500) {
    await ctx.runMutation(q.finishIdempotentRequest, {
      id: reservation.id,
      status: result.status,
      body: JSON.stringify(result.body),
    });
  } else {
    await ctx.runMutation(q.abandonIdempotentRequest, { id: reservation.id });
  }
  return toResponse(result);
}

const DOCS_CACHE = 'public, max-age=300';

// Swagger UI from the CDN, pointed at the served spec; the Authorize button takes the user's own key.
const SWAGGER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fabulous CRM API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script><script>window.ui=SwaggerUIBundle({url:'/api/v1/openapi.json',dom_id:'#swagger-ui',persistAuthorization:true,tryItOutEnabled:true,displayRequestDuration:true});</script></body></html>`;

/** The spec with `servers` pointing at this deployment. */
function openapiFor(request: Request): Record<string, unknown> {
  const origin = new URL(request.url).origin;
  return { ...openapiDocument, servers: [{ url: `${origin}${API_PREFIX.slice(0, -1)}` }] };
}

export function registerApiRoutes(http: HttpRouter): void {
  // Exact routes win over the prefix ones: the docs need no key (they describe, they reveal nothing).
  http.route({
    path: `${API_PREFIX}openapi.json`,
    method: 'GET',
    handler: httpAction(async (_ctx, request) =>
      Response.json(openapiFor(request), { headers: { 'Cache-Control': DOCS_CACHE } }),
    ),
  });
  http.route({
    path: `${API_PREFIX}docs`,
    method: 'GET',
    handler: httpAction(
      async () =>
        new Response(SWAGGER_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': DOCS_CACHE },
        }),
    ),
  });
  for (const method of METHODS) {
    http.route({
      pathPrefix: API_PREFIX,
      method,
      handler: httpAction((ctx, request) => handle(ctx, request, method)),
    });
  }
}
