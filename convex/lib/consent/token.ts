import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { isNotDeleted } from '../shared/db';
import { enforceRateLimit } from '../security/rateLimits';

/** The live lead a consent token names, or nothing: a deleted contact's link is dead. */
export async function leadOfConsentToken(
  ctx: Pick<QueryCtx, 'db'>,
  token: string,
): Promise<Doc<'leads'> | null> {
  if (!token) return null;
  const lead = await ctx.db
    .query('leads')
    .withIndex('by_consentToken', (q) => q.eq('consentToken', token))
    .first();
  return lead && isNotDeleted(lead) ? lead : null;
}

export type ConsentRefusal = 'invalid_token' | 'rate_limited';

/** The lead a write by token may touch, within the limits: invalid tokens share one small bucket against enumeration, a valid one has its own; the route bounds the whole first. */
export async function leadForConsentWrite(
  ctx: MutationCtx,
  token: string,
): Promise<{ lead: Doc<'leads'> } | { error: ConsentRefusal }> {
  const lead = await leadOfConsentToken(ctx, token);
  if (!lead) {
    const ok = await enforceRateLimit(ctx, 'consentInvalid');
    return { error: ok ? 'invalid_token' : 'rate_limited' };
  }
  if (!(await enforceRateLimit(ctx, 'consentUpdate', token))) return { error: 'rate_limited' };
  return { lead };
}
