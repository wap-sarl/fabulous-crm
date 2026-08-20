/**
 * Catalog of well-known social providers Better Auth can register (Google,
 * Microsoft, GitHub, LinkedIn).
 *
 * `key` is the Better Auth provider key AND the DB `id` in
 * `appConfig.auth.socialProviders` AND the OAuth callback slug
 * (`/api/auth/callback/<key>`). Credentials live in the database (configured via
 * the setup wizard / settings), NOT env vars — they are resolved at request time
 * by `createAuth` (convex/auth.ts). This is the single source of truth for the
 * provider labels shared by the auth factory and the public config query; keep
 * it free of heavy deps so query bundles stay light.
 */
export const SOCIAL_PROVIDERS = [
  { key: 'google', label: 'Google' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'github', label: 'GitHub' },
  { key: 'linkedin', label: 'LinkedIn' },
] as const;

export type SocialProviderKey = (typeof SOCIAL_PROVIDERS)[number]['key'];
