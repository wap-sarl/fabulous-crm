/** HTTP actions are limited per client IP; public mutations and queries have no request context, so they are keyed per resource, with a global bucket bounding the noise of invalid tokens. */
import { HOUR, MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { components } from '../../_generated/api';
import { TRACK_TOTAL_PER_MINUTE } from '../../_lib/validators/tracking';

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Public consent page writes, per consent token.
  consentUpdate: { kind: 'token bucket', rate: 10, period: MINUTE },
  // Invalid-token attempts on the consent mutation, one global bucket.
  consentInvalid: { kind: 'token bucket', rate: 30, period: MINUTE },
  // Tracked-link clicks (GET /l/<token>), per client IP.
  trackedLink: { kind: 'token bucket', rate: 60, period: MINUTE },
  // Sign-in OTP emails, per normalized email address.
  otpEmail: { kind: 'token bucket', rate: 5, period: 15 * MINUTE },
  // RPPS verification (billed external API), per employee.
  rppsVerify: { kind: 'token bucket', rate: 30, period: HOUR },
  // Company registration lookups (public registries, e.g. INSEE), per employee.
  registryVerify: { kind: 'token bucket', rate: 60, period: HOUR },
  // Authenticated REST API traffic (/api/v1/), per API key.
  apiRequest: { kind: 'token bucket', rate: 600, period: MINUTE },
  // REST API writes (POST/PATCH/DELETE), per API key, on top of apiRequest (10k contacts ≈ 30 min).
  apiWrite: { kind: 'token bucket', rate: 300, period: MINUTE },
  // Failed REST API auth attempts, per client IP — key brute-force guard.
  apiAuthFail: { kind: 'token bucket', rate: 10, period: MINUTE },
  // Public form definition fetches (GET /forms/*), per client IP.
  formRender: { kind: 'token bucket', rate: 60, period: MINUTE },
  // Public form submissions (POST /forms/<id>/submit), per client IP.
  formSubmit: { kind: 'token bucket', rate: 10, period: MINUTE },
  // The same, per form, then for the whole deployment: a botnet spread over addresses still meets a ceiling.
  formSubmitPerForm: { kind: 'token bucket', rate: 200, period: HOUR },
  formSubmitTotal: { kind: 'token bucket', rate: 1000, period: HOUR },
  // Page-view beacons (POST /track), per client IP and per visitor id.
  trackBeacon: { kind: 'token bucket', rate: 120, period: MINUTE },
  trackVisitor: { kind: 'token bucket', rate: 60, period: MINUTE },
  // The same for the whole deployment, counted in views: 864 000 a day at most, whatever the addresses.
  trackTotal: { kind: 'token bucket', rate: TRACK_TOTAL_PER_MINUTE, period: MINUTE },
});

type LimitName =
  | 'consentUpdate'
  | 'consentInvalid'
  | 'trackedLink'
  | 'otpEmail'
  | 'rppsVerify'
  | 'registryVerify'
  | 'apiRequest'
  | 'apiWrite'
  | 'apiAuthFail'
  | 'formRender'
  | 'formSubmit'
  | 'formSubmitPerForm'
  | 'formSubmitTotal'
  | 'trackBeacon'
  | 'trackVisitor'
  | 'trackTotal';

/** False, with the overrun logged, when the limit is exhausted: the caller decides the shape of the refusal. */
export async function enforceRateLimit(
  ctx: Parameters<(typeof rateLimiter)['limit']>[0],
  name: LimitName,
  key?: string,
  count = 1,
): Promise<boolean> {
  return (await consumeRateLimit(ctx, name, key, count)).ok;
}

/** Whether `key` still has budget on `name`, without consuming any — a pre-check before costly work. */
export async function checkRateLimit(
  ctx: Parameters<(typeof rateLimiter)['check']>[0],
  name: LimitName,
  key?: string,
): Promise<{ ok: boolean; retryAfterMs: number }> {
  const { ok, retryAfter } = await rateLimiter.check(ctx, name, key ? { key } : {});
  return { ok, retryAfterMs: ok ? 0 : Math.ceil(retryAfter) };
}

/** Like enforceRateLimit, but hands back retryAfter for a Retry-After header. */
export async function consumeRateLimit(
  ctx: Parameters<(typeof rateLimiter)['limit']>[0],
  name: LimitName,
  key?: string,
  count = 1,
): Promise<{ ok: boolean; retryAfterMs: number }> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, name, { ...(key && { key }), count });
  const retryAfterMs = ok ? 0 : Math.ceil(retryAfter);
  if (!ok) {
    console.warn('rate_limit_exceeded', { limit: name, key, retryAfterMs });
  }
  return { ok, retryAfterMs };
}

/** Only x-forwarded-for is trusted, as Convex's edge sets it from the connecting address and a client could spoof anything else; absent in local dev, all share one key. */
export function clientIpOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}
