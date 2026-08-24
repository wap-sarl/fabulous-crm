/**
 * Rate limiting for the public surfaces (#17), backed by the
 * @convex-dev/rate-limiter component. One shared utility — every current and
 * future public route opts in with a single `enforceRateLimit` call.
 *
 * Keying strategy per surface:
 * - HTTP actions see a client IP (x-forwarded-for, set by Convex's edge) —
 *   per-IP limits work there.
 * - Public mutations/queries have NO request context, so per-IP is impossible;
 *   they use per-resource keys (the consent token) plus a small global bucket
 *   on invalid-token attempts as an enumeration guard. The 24-byte random
 *   token space already makes enumeration cryptographically infeasible — the
 *   global bucket bounds the write/log noise, not the search space.
 * - Better Auth's /api/auth/* routes use its built-in per-IP limiter
 *   (configured in convex/auth.ts, persisted in the component's rateLimit
 *   table); the per-email OTP budget below complements it.
 */
import { HOUR, MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { components } from '../_generated/api';

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
});

type LimitName = 'consentUpdate' | 'consentInvalid' | 'trackedLink' | 'otpEmail' | 'rppsVerify';

/**
 * Consume one unit of `name` for `key`. Returns false — and logs the overrun —
 * when the limit is exhausted; the caller decides the refusal shape (429, error
 * code…). Works from mutations, actions, and HTTP actions.
 */
export async function enforceRateLimit(
  ctx: Parameters<(typeof rateLimiter)['limit']>[0],
  name: LimitName,
  key?: string,
): Promise<boolean> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, name, key ? { key } : {});
  if (!ok) {
    console.warn('rate_limit_exceeded', { limit: name, key, retryAfterMs: Math.ceil(retryAfter) });
  }
  return ok;
}

/**
 * Client IP for HTTP actions: first entry of x-forwarded-for, which Convex's
 * edge sets from the connecting address. Only that platform-set header is
 * trusted — anything else a client could spoof. Falls back to a shared bucket
 * key when absent (local dev).
 */
export function clientIpOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}
