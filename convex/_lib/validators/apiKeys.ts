import { type Infer, v } from 'convex/values';
import { logsValidator } from './shared';

/** Key format: wap_<keyId>_<secret> — keyId is public, the secret is shown once. */
export const API_KEY_PREFIX = 'wap';
export const API_KEY_ID_BYTES = 4;
export const API_KEY_SECRET_BYTES = 24;

export const MAX_API_KEY_NAME_LENGTH = 60;

/** Write scopes do not imply read — a pure ingestion key can be write-only. */
export const API_SCOPES = [
  'contacts:read',
  'contacts:write',
  'companies:read',
  'companies:write',
  'deals:read',
  'deals:write',
  'activities:read',
  'activities:write',
  'lists:read',
  'forms:read',
  'properties:read',
] as const;

export const apiScopeValidator = v.union(...API_SCOPES.map((s) => v.literal(s)));

export type ApiScope = Infer<typeof apiScopeValidator>;

export const apiKeyValidator = v.object({
  ...logsValidator.fields,
  // Public identifier (8 hex chars) — safe in logs and shown in the UI.
  keyId: v.string(),
  // Salted SHA-256 of the secret, hex. The secret itself is never stored.
  secretHash: v.string(),
  name: v.string(),
  scopes: v.array(apiScopeValidator),
  expiresAt: v.optional(v.number()),
  // Soft revocation: the row is kept so audit entries stay resolvable.
  revokedAt: v.optional(v.number()),
  // Throttled: patched at most every five minutes (see touchApiKey).
  lastUsedAt: v.optional(v.number()),
});

export type ApiKey = Infer<typeof apiKeyValidator>;

export function validateApiKeyShape(fields: { name: string; scopes: string[] }): string | null {
  if (!fields.name.trim()) return 'api_key_name_required';
  if (fields.name.trim().length > MAX_API_KEY_NAME_LENGTH) return 'api_key_name_too_long';
  if (fields.scopes.length === 0) return 'api_key_scopes_required';
  if (new Set(fields.scopes).size !== fields.scopes.length) return 'api_key_duplicate_scope';
  return null;
}

/** Idempotency-Key replays are honoured for this long after the first request. */
export const API_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/** One row per (API key, Idempotency-Key): reserved before the write, completed with the response, swept after the TTL. */
export const apiIdempotencyKeyValidator = v.object({
  apiKeyId: v.id('apiKeys'),
  key: v.string(),
  // SHA-256 of method + path + body: the same key on a different request is an error.
  fingerprint: v.string(),
  status: v.union(v.literal('pending'), v.literal('done')),
  responseStatus: v.optional(v.number()),
  responseBody: v.optional(v.string()),
  expiresAt: v.number(),
});

export type ApiIdempotencyKey = Infer<typeof apiIdempotencyKeyValidator>;
