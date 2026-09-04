import {
  API_KEY_ID_BYTES,
  API_KEY_PREFIX,
  API_KEY_SECRET_BYTES,
  type ApiScope,
} from '../_lib/validators/apiKeys';
import type { Doc } from '../_generated/dataModel';
import { timingSafeEqual } from './crypto';

/** lastUsedAt is only re-stamped when older than this, not on every request. */
export const API_KEY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const BEARER_RE = new RegExp(
  `^Bearer ${API_KEY_PREFIX}_([0-9a-f]{${API_KEY_ID_BYTES * 2}})_([0-9a-f]{${API_KEY_SECRET_BYTES * 2}})$`,
);

/** Split a `wap_<keyId>_<secret>` bearer header; null on any malformation. */
export function parseApiBearer(header: string | null): { keyId: string; secret: string } | null {
  const match = header?.match(BEARER_RE);
  return match ? { keyId: match[1], secret: match[2] } : null;
}

/** Salted SHA-256 of an API key secret, hex. The salt only hardens leaked rows. */
export async function hashApiKeySecret(secret: string): Promise<string> {
  const salt = process.env.API_KEY_HASH_SALT ?? 'wap-crm-api';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:${secret}`),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time secret check plus the revocation and expiry gates. */
export async function apiKeyAccepts(key: Doc<'apiKeys'>, secret: string): Promise<boolean> {
  if (key.revokedAt !== undefined) return false;
  if (key.expiresAt !== undefined && key.expiresAt <= Date.now()) return false;
  return timingSafeEqual(await hashApiKeySecret(secret), key.secretHash);
}

/** A write scope implies the read scope of the same resource. */
export function hasScope(key: Pick<Doc<'apiKeys'>, 'scopes'>, scope: ApiScope): boolean {
  if (key.scopes.includes(scope)) return true;
  const [resource, level] = scope.split(':');
  return level === 'read' && key.scopes.includes(`${resource}:write` as ApiScope);
}
