/** `key` is at once the Better Auth provider key, the `id` in `appConfig.auth.socialProviders` and the OAuth callback slug; keep this file free of heavy imports, queries bundle it. */
export const SOCIAL_PROVIDERS = [
  { key: 'google', label: 'Google' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'github', label: 'GitHub' },
  { key: 'linkedin', label: 'LinkedIn' },
] as const;
