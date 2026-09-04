import type { HttpRouter } from 'convex/server';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import { httpAction, type ActionCtx } from '../../_generated/server';
import { MAX_IDEMPOTENCY_KEY_LENGTH, type ApiScope } from '../../_lib/validators/apiKeys';
import {
  API_KEY_TOUCH_INTERVAL_MS,
  apiKeyAccepts,
  hasScope,
  parseApiBearer,
} from '../../lib/apiAuth';
import {
  activityCreateBody,
  activityPatchBody,
  companyCreateBody,
  companyPatchBody,
  contactCreateBody,
  contactPatchBody,
  dealCreateBody,
  dealPatchBody,
  parseBody,
  READ_ONLY_FIELDS,
} from '../../lib/apiBodies';
import { apiError, isApiError } from '../../lib/apiErrors';
import { clientIpOf, consumeRateLimit } from '../../lib/rateLimits';

const API_PREFIX = '/api/v1/';
const METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

type ApiResult = { status: number; body: unknown };

interface ApiRequest {
  key: Doc<'apiKeys'>;
  url: URL;
  /** `:name` captures of the matched route pattern. */
  params: Record<string, string>;
  /** Decoded JSON body (POST/PATCH). */
  body: unknown;
}

interface ApiRoute {
  method: Method;
  /** Segments after the prefix, `:name` capturing one segment — e.g. `contacts/:id`. */
  pattern: string;
  /** Scope the key must hold; absent on `/me`. */
  scope?: ApiScope;
  handler: (ctx: ActionCtx, req: ApiRequest) => Promise<ApiResult>;
}

const ok = (body: unknown, status = 200): ApiResult => ({ status, body });
const noContent: ApiResult = { status: 204, body: null };
const notFound = (message = 'No such record.'): ApiResult => errorResult(404, 'not_found', message);

function errorResult(status: number, code: string, message: string, details?: unknown): ApiResult {
  return {
    status,
    body: { error: { code, message, ...(details !== undefined ? { details } : {}) } },
  };
}

function toResponse(result: ApiResult, headers: Record<string, string> = {}): Response {
  return new Response(result.status === 204 ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const rateLimited = (retryAfterMs: number): Response =>
  toResponse(errorResult(429, 'rate_limited', 'Too many requests.'), {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
  });

// Pagination

const API_PAGE_LIMIT_DEFAULT = 50;
const API_PAGE_LIMIT_MAX = 100;

/** `?limit=`/`?cursor=` → Convex paginationOpts; throws on an invalid limit. */
function paginationOptsOf(url: URL): { numItems: number; cursor: string | null } {
  const raw = url.searchParams.get('limit');
  const numItems = raw === null ? API_PAGE_LIMIT_DEFAULT : Number(raw);
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > API_PAGE_LIMIT_MAX) {
    throw apiError(
      400,
      'invalid_limit',
      `limit must be an integer between 1 and ${API_PAGE_LIMIT_MAX}.`,
    );
  }
  return { numItems, cursor: url.searchParams.get('cursor') };
}

/** A garbage `?cursor=` throws with runtime-specific wording: any non-API error with a cursor is the cursor. */
const isCursorError = (error: unknown, req: ApiRequest): boolean =>
  error instanceof Error &&
  (/cursor/i.test(error.message) || req.url.searchParams.get('cursor') !== null);

// Routes

const q = internal.features.api.internal;
const w = internal.features.api.writes;

const ROUTES: ApiRoute[] = [
  {
    method: 'GET',
    pattern: 'me',
    handler: async (_ctx, { key }) =>
      ok({
        name: key.name,
        keyId: key.keyId,
        scopes: key.scopes,
        expiresAt: key.expiresAt ?? null,
      }),
  },

  // Contacts
  {
    method: 'GET',
    pattern: 'contacts',
    scope: 'contacts:read',
    handler: async (ctx, { url }) =>
      ok(
        await ctx.runQuery(q.listContacts, {
          paginationOpts: paginationOptsOf(url),
          email: url.searchParams.get('email') ?? undefined,
        }),
      ),
  },
  {
    method: 'GET',
    pattern: 'contacts/:id',
    scope: 'contacts:read',
    handler: async (ctx, { params }) => {
      const contact = await ctx.runQuery(q.getContact, { id: params.id });
      return contact ? ok(contact) : notFound();
    },
  },
  {
    method: 'POST',
    pattern: 'contacts',
    scope: 'contacts:write',
    handler: async (ctx, { key, body }) =>
      ok(
        await ctx.runMutation(w.createContact, {
          apiKeyId: key._id,
          body: parseBody(contactCreateBody, body, READ_ONLY_FIELDS.contacts),
        }),
        201,
      ),
  },
  {
    method: 'POST',
    pattern: 'contacts/upsert',
    scope: 'contacts:write',
    handler: async (ctx, { key, body }) => {
      const result = await ctx.runMutation(w.upsertContact, {
        apiKeyId: key._id,
        body: parseBody(contactCreateBody, body, READ_ONLY_FIELDS.contacts),
      });
      return ok(result, result.created ? 201 : 200);
    },
  },
  {
    method: 'PATCH',
    pattern: 'contacts/:id',
    scope: 'contacts:write',
    handler: async (ctx, { key, params, body }) =>
      ok(
        await ctx.runMutation(w.updateContact, {
          apiKeyId: key._id,
          id: params.id,
          body: parseBody(contactPatchBody, body, READ_ONLY_FIELDS.contacts),
        }),
      ),
  },
  {
    method: 'DELETE',
    pattern: 'contacts/:id',
    scope: 'contacts:write',
    handler: async (ctx, { key, params }) => {
      await ctx.runMutation(w.deleteContact, { apiKeyId: key._id, id: params.id });
      return noContent;
    },
  },

  // Companies
  {
    method: 'GET',
    pattern: 'companies',
    scope: 'companies:read',
    handler: async (ctx, { url }) =>
      ok(
        await ctx.runQuery(q.listCompanies, {
          paginationOpts: paginationOptsOf(url),
          domain: url.searchParams.get('domain') ?? undefined,
        }),
      ),
  },
  {
    method: 'GET',
    pattern: 'companies/:id',
    scope: 'companies:read',
    handler: async (ctx, { params }) => {
      const company = await ctx.runQuery(q.getCompany, { id: params.id });
      return company ? ok(company) : notFound();
    },
  },
  {
    method: 'POST',
    pattern: 'companies',
    scope: 'companies:write',
    handler: async (ctx, { key, body }) =>
      ok(
        await ctx.runMutation(w.createCompany, {
          apiKeyId: key._id,
          body: parseBody(companyCreateBody, body, READ_ONLY_FIELDS.companies),
        }),
        201,
      ),
  },
  {
    method: 'PATCH',
    pattern: 'companies/:id',
    scope: 'companies:write',
    handler: async (ctx, { key, params, body }) =>
      ok(
        await ctx.runMutation(w.updateCompany, {
          apiKeyId: key._id,
          id: params.id,
          body: parseBody(companyPatchBody, body, READ_ONLY_FIELDS.companies),
        }),
      ),
  },
  {
    method: 'DELETE',
    pattern: 'companies/:id',
    scope: 'companies:write',
    handler: async (ctx, { key, params }) => {
      await ctx.runMutation(w.deleteCompany, { apiKeyId: key._id, id: params.id });
      return noContent;
    },
  },

  // Deals
  {
    method: 'GET',
    pattern: 'deals',
    scope: 'deals:read',
    handler: async (ctx, { url }) =>
      ok(
        await ctx.runQuery(q.listDeals, {
          paginationOpts: paginationOptsOf(url),
          leadId: url.searchParams.get('leadId') ?? undefined,
        }),
      ),
  },
  {
    method: 'GET',
    pattern: 'deals/:id',
    scope: 'deals:read',
    handler: async (ctx, { params }) => {
      const deal = await ctx.runQuery(q.getDeal, { id: params.id });
      return deal ? ok(deal) : notFound();
    },
  },
  {
    method: 'POST',
    pattern: 'deals',
    scope: 'deals:write',
    handler: async (ctx, { key, body }) =>
      ok(
        await ctx.runMutation(w.createDeal, {
          apiKeyId: key._id,
          body: parseBody(dealCreateBody, body, READ_ONLY_FIELDS.deals),
        }),
        201,
      ),
  },
  {
    method: 'PATCH',
    pattern: 'deals/:id',
    scope: 'deals:write',
    handler: async (ctx, { key, params, body }) =>
      ok(
        await ctx.runMutation(w.updateDeal, {
          apiKeyId: key._id,
          id: params.id,
          body: parseBody(dealPatchBody, body, READ_ONLY_FIELDS.deals),
        }),
      ),
  },
  {
    method: 'DELETE',
    pattern: 'deals/:id',
    scope: 'deals:write',
    handler: async (ctx, { key, params }) => {
      await ctx.runMutation(w.deleteDeal, { apiKeyId: key._id, id: params.id });
      return noContent;
    },
  },

  // Activities
  {
    method: 'GET',
    pattern: 'activities',
    scope: 'activities:read',
    handler: async (ctx, { url }) =>
      ok(
        await ctx.runQuery(q.listActivities, {
          paginationOpts: paginationOptsOf(url),
          leadId: url.searchParams.get('leadId') ?? undefined,
        }),
      ),
  },
  {
    method: 'GET',
    pattern: 'activities/:id',
    scope: 'activities:read',
    handler: async (ctx, { params }) => {
      const activity = await ctx.runQuery(q.getActivity, { id: params.id });
      return activity ? ok(activity) : notFound();
    },
  },
  {
    method: 'POST',
    pattern: 'activities',
    scope: 'activities:write',
    handler: async (ctx, { key, body }) =>
      ok(
        await ctx.runMutation(w.createActivity, {
          apiKeyId: key._id,
          body: parseBody(activityCreateBody, body, READ_ONLY_FIELDS.activities),
        }),
        201,
      ),
  },
  {
    method: 'PATCH',
    pattern: 'activities/:id',
    scope: 'activities:write',
    handler: async (ctx, { key, params, body }) =>
      ok(
        await ctx.runMutation(w.updateActivity, {
          apiKeyId: key._id,
          id: params.id,
          body: parseBody(activityPatchBody, body, READ_ONLY_FIELDS.activities),
        }),
      ),
  },
  {
    method: 'DELETE',
    pattern: 'activities/:id',
    scope: 'activities:write',
    handler: async (ctx, { key, params }) => {
      await ctx.runMutation(w.deleteActivity, { apiKeyId: key._id, id: params.id });
      return noContent;
    },
  },

  // Read-only resources
  {
    method: 'GET',
    pattern: 'lists',
    scope: 'lists:read',
    handler: async (ctx) => ok(await ctx.runQuery(q.listLists, {})),
  },
  {
    method: 'GET',
    pattern: 'lists/:id/members',
    scope: 'lists:read',
    handler: async (ctx, { url, params }) => {
      const members = await ctx.runQuery(q.listListMembers, {
        listId: params.id,
        paginationOpts: paginationOptsOf(url),
      });
      return members ? ok(members) : notFound('No such list.');
    },
  },
  {
    method: 'GET',
    pattern: 'properties',
    scope: 'properties:read',
    handler: async (ctx, { url }) => {
      const entityType = url.searchParams.get('entityType');
      if (!entityType) {
        return errorResult(400, 'missing_entity_type', 'The entityType parameter is required.');
      }
      const result = await ctx.runQuery(q.listProperties, { entityType });
      return result ? ok(result) : errorResult(400, 'invalid_entity_type', 'Unknown entityType.');
    },
  },
];

/** Every route of the table — the OpenAPI spec test checks the document against it. */
export const API_ROUTE_TABLE: readonly { method: Method; pattern: string; scope?: ApiScope }[] =
  ROUTES.map(({ method, pattern, scope }) => ({ method, pattern, scope }));

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
  const failed = async (): Promise<{ response: Response }> => {
    const fail = await consumeRateLimit(ctx, 'apiAuthFail', clientIpOf(request));
    if (!fail.ok) return { response: rateLimited(fail.retryAfterMs) };
    return { response: toResponse(errorResult(401, 'unauthorized', 'Invalid API key.')) };
  };

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
  if (key.lastUsedAt === undefined || Date.now() - key.lastUsedAt >= API_KEY_TOUCH_INTERVAL_MS) {
    await ctx.runMutation(q.touchApiKey, { id: key._id });
  }

  const match = matchRoute(method, segments);
  if (!match) return toResponse(errorResult(404, 'not_found', 'Unknown resource.'));
  const { route, params } = match;
  if (route.scope && !hasScope(key, route.scope)) {
    return toResponse(
      errorResult(403, 'missing_scope', `This key lacks the ${route.scope} scope.`),
    );
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

export function registerApiRoutes(http: HttpRouter): void {
  for (const method of METHODS) {
    http.route({
      pathPrefix: API_PREFIX,
      method,
      handler: httpAction((ctx, request) => handle(ctx, request, method)),
    });
  }
}
