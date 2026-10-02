import { boundedInt, follows } from '../../_lib/validators/fields';
import type { Doc } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import type { ApiScope } from '../../_lib/validators/apiKeys';
import { apiError } from './errors';

export const METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

export type ApiResult = { status: number; body: unknown };

export interface ApiRequest {
  key: Doc<'apiKeys'>;
  url: URL;
  /** `:name` captures of the matched route pattern. */
  params: Record<string, string>;
  /** Decoded JSON body (POST/PATCH). */
  body: unknown;
}

export interface ApiRoute {
  method: Method;
  /** Segments after the prefix, `:name` capturing one segment — e.g. `contacts/:id`. */
  pattern: string;
  /** Scope(s) the key must hold; absent on `/me`. */
  scope?: ApiScope | ApiScope[];
  handler: (ctx: ActionCtx, req: ApiRequest) => Promise<ApiResult>;
}

export const ok = (body: unknown, status = 200): ApiResult => ({ status, body });
export const noContent: ApiResult = { status: 204, body: null };
export const notFound = (message = 'No such record.'): ApiResult =>
  errorResult(404, 'not_found', message);

export function errorResult(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiResult {
  return {
    status,
    body: { error: { code, message, ...(details !== undefined ? { details } : {}) } },
  };
}

export function toResponse(result: ApiResult, headers: Record<string, string> = {}): Response {
  return new Response(result.status === 204 ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const rateLimited = (retryAfterMs: number): Response =>
  toResponse(errorResult(429, 'rate_limited', 'Too many requests.'), {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
  });

// Pagination

const API_PAGE_LIMIT_DEFAULT = 50;
const API_PAGE_LIMIT_MAX = 100;

/** `?limit=`/`?cursor=` → Convex paginationOpts; throws on an invalid limit. */
export function paginationOptsOf(url: URL): { numItems: number; cursor: string | null } {
  const raw = url.searchParams.get('limit');
  const numItems = raw === null ? API_PAGE_LIMIT_DEFAULT : Number(raw);
  if (!follows(boundedInt(1, API_PAGE_LIMIT_MAX), numItems)) {
    throw apiError(
      400,
      'invalid_limit',
      `limit must be an integer between 1 and ${API_PAGE_LIMIT_MAX}.`,
    );
  }
  return { numItems, cursor: url.searchParams.get('cursor') };
}

/** A garbage `?cursor=` throws with runtime-specific wording: any non-API error with a cursor is the cursor. */
export const isCursorError = (error: unknown, req: ApiRequest): boolean =>
  error instanceof Error &&
  (/cursor/i.test(error.message) || req.url.searchParams.get('cursor') !== null);
