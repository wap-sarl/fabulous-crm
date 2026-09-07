import { validate } from 'convex-helpers/validators';
import { EDITION_REQUIRED, type EeFeature } from '../../ee/contract';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  type EntitlementsPayload,
  entitlementsPayloadValidator,
  type Plan,
  type QuotaKind,
} from '../_lib/validators/entitlements';
import { ENTITLEMENTS_PUBLIC_KEYS } from './entitlementsKeys';

export type Edition = 'ce' | 'saas';
export type TenantStatus = 'active' | 'suspended';

/** `saas` when hosted by WAP, `ce` otherwise; informational, never a gate on its own. */
export const edition = (): Edition => (process.env.EDITION === 'saas' ? 'saas' : 'ce');
export const isSaas = () => edition() === 'saas';
export const tenantId = () => process.env.TENANT_ID ?? '';
export const tenantStatus = (): TenantStatus =>
  process.env.TENANT_STATUS === 'suspended' ? 'suspended' : 'active';
export const isTenantSuspended = () => tenantStatus() === 'suspended';

/** Employee and API entry points refuse a suspended tenant; crons and public surfaces keep running. */
export function assertTenantActive(): void {
  if (isTenantSuspended()) throw new Error('tenant_suspended');
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Features stay on this long after `exp`, so a late re-signing never locks a customer out. */
export const ENTITLEMENTS_GRACE_MS = 7 * DAY_MS;

export interface EntitlementsState {
  edition: Edition;
  /** `token` when a valid signed token is in force, `ce` otherwise. */
  source: 'ce' | 'token';
  /** Why the token was ignored, when one was set. */
  reason: string | null;
  plan: Plan | null;
  features: EeFeature[];
  seats: number | null;
  workflowRunsPerMonth: number | null;
  apiCallsPerMonth: number | null;
  retentionDays: { audit: number | null; events: number | null };
  expiresAt: number | null;
  /** Within seven days of `exp`, before or after: the control plane should re-sign. */
  expiring: boolean;
}

type Verified = { ok: true; payload: EntitlementsPayload } | { ok: false; reason: string };

let publicKeys: readonly JsonWebKey[] = ENTITLEMENTS_PUBLIC_KEYS;
const verified = new Map<string, Promise<Verified>>();
let warnedFor: string | null = null;

/** Test seam: the real keys are compiled in; tests sign with a throwaway pair. */
export function _setPublicKeysForTests(keys: readonly JsonWebKey[]): void {
  publicKeys = keys;
  verified.clear();
  warnedFor = null;
}

function decodeBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyToken(token: string): Promise<Verified> {
  const [payloadPart, signaturePart, ...rest] = token.split('.');
  if (!payloadPart || !signaturePart || rest.length > 0) {
    return { ok: false, reason: 'malformed_token' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart)));
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  try {
    validate(entitlementsPayloadValidator, payload, { throw: true });
  } catch {
    return { ok: false, reason: 'invalid_payload' };
  }
  const signature = decodeBase64Url(signaturePart);
  const signed = new TextEncoder().encode(payloadPart);
  for (const jwk of publicKeys) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      if (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed)) {
        return { ok: true, payload: payload as EntitlementsPayload };
      }
    } catch {
      // A malformed key in the list must not mask the others.
    }
  }
  return { ok: false, reason: 'bad_signature' };
}

/** Signature checks are memoised per token; expiry and tenant binding are re-evaluated on every call. */
function verifyCached(token: string): Promise<Verified> {
  let pending = verified.get(token);
  if (!pending) {
    pending = verifyToken(token);
    verified.set(token, pending);
  }
  return pending;
}

function ceState(reason: string | null): EntitlementsState {
  return {
    edition: edition(),
    source: 'ce',
    reason,
    plan: null,
    features: [],
    seats: null,
    workflowRunsPerMonth: null,
    apiCallsPerMonth: null,
    retentionDays: { audit: null, events: null },
    expiresAt: null,
    expiring: false,
  };
}

function ignored(token: string, reason: string): EntitlementsState {
  if (warnedFor !== token) {
    warnedFor = token;
    console.warn(`ENTITLEMENTS ignored (${reason}); running with community-edition limits.`);
  }
  return ceState(reason);
}

/** The entitlements in force. A missing or invalid token never throws: it means community edition. */
export async function loadEntitlements(now = Date.now()): Promise<EntitlementsState> {
  const token = process.env.ENTITLEMENTS?.trim();
  if (!token) return ceState(null);
  const result = await verifyCached(token);
  if (!result.ok) return ignored(token, result.reason);
  const { payload } = result;
  if (payload.tenant !== tenantId()) return ignored(token, 'tenant_mismatch');
  if (now > payload.exp + ENTITLEMENTS_GRACE_MS) return ignored(token, 'expired');
  return {
    edition: edition(),
    source: 'token',
    reason: null,
    plan: payload.plan,
    features: [...payload.features],
    seats: payload.seats,
    workflowRunsPerMonth: payload.workflowRunsPerMonth,
    apiCallsPerMonth: payload.apiCallsPerMonth,
    retentionDays: { ...payload.retentionDays },
    expiresAt: payload.exp,
    expiring: now >= payload.exp - ENTITLEMENTS_GRACE_MS,
  };
}

export async function hasFeature(feature: EeFeature): Promise<boolean> {
  return (await loadEntitlements()).features.includes(feature);
}

/** Gate of every paid entry point, server-side: the community build is public and callable by name. */
export async function requireFeature(feature: EeFeature): Promise<void> {
  if (!(await hasFeature(feature))) throw new Error(`${EDITION_REQUIRED}: ${feature}`);
}

export async function retentionDays(kind: 'audit' | 'events'): Promise<number | null> {
  return (await loadEntitlements()).retentionDays[kind];
}

/** Live employees, the unit the `seats` limit counts. */
export async function countSeatsUsed(ctx: QueryCtx | MutationCtx): Promise<number> {
  const employees = await ctx.db
    .query('users')
    .withIndex('by_type', (q) => q.eq('type', 'employee'))
    .collect();
  return employees.filter((u) => u.deletedAt == null).length;
}

/** Refuses when the plan's seats are all taken; `reserved` adds pending invitations at invite time. */
export async function requireSeatAvailable(
  ctx: QueryCtx | MutationCtx,
  reserved = 0,
): Promise<void> {
  const { seats } = await loadEntitlements();
  if (seats === null) return;
  if ((await countSeatsUsed(ctx)) + reserved >= seats) throw new Error('seat_limit_reached');
}

export type QuotaResult = { ok: boolean; limit: number | null; used: number };

const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);

/** Counts one unit against the monthly quota of `kind`; unlimited plans are not counted at all. */
export async function consumeQuota(
  ctx: MutationCtx,
  kind: QuotaKind,
  subject = '',
  now = Date.now(),
): Promise<QuotaResult> {
  const state = await loadEntitlements(now);
  const limit = kind === 'workflowRuns' ? state.workflowRunsPerMonth : state.apiCallsPerMonth;
  if (limit === null) return { ok: true, limit, used: 0 };
  const month = monthKey(now);
  const rows = await ctx.db
    .query('usageCounters')
    .withIndex('by_kind_month_subject', (q) => q.eq('kind', kind).eq('month', month))
    .collect();
  const used = rows.reduce((sum, row) => sum + row.count, 0);
  if (used >= limit) return { ok: false, limit, used };
  const own = rows.find((row) => row.subject === subject);
  if (own) await ctx.db.patch(own._id, { count: own.count + 1 });
  else await ctx.db.insert('usageCounters', { kind, month, subject, count: 1 });
  return { ok: true, limit, used: used + 1 };
}
