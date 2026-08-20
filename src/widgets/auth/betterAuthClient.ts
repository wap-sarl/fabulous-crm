import { createAuthClient } from 'better-auth/react';
import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { emailOTPClient, genericOAuthClient } from 'better-auth/client/plugins';
import type { AuthClient } from '@convex-dev/better-auth/react';

type AuthResult = {
  data: unknown;
  error: { code?: string; message?: string; status?: number; statusText?: string } | null;
};

/**
 * The slice of the Better Auth client surface this app actually calls, typed by
 * hand. The client's fully-inferred type is not nameable in declaration emit
 * (TS7056, and TS2883 via the emailOTP plugin's zod internals), so the export
 * needs an explicit annotation — which also flows a provider-compatible type
 * into `createAuthClient`, so the client passes to `ConvexBetterAuthProvider`
 * without any cast.
 */
export type SocialProvider = 'google' | 'microsoft' | 'github' | 'linkedin';

/** Type guard narrowing a dynamic config id to a known social provider. */
export function isSocialProvider(id: string): id is SocialProvider {
  return id === 'google' || id === 'microsoft' || id === 'github' || id === 'linkedin';
}

type AppAuthSurface = {
  signIn: {
    social: (args: {
      provider: SocialProvider;
      callbackURL?: string;
      errorCallbackURL?: string;
    }) => Promise<AuthResult>;
    // Custom SSO issuers via the generic-oauth plugin. `providerId` is the DB slug
    // (server `ssoProviders`), mirroring `signIn.social` for the well-known ones.
    oauth2: (args: {
      providerId: string;
      callbackURL?: string;
      errorCallbackURL?: string;
    }) => Promise<AuthResult>;
    emailOtp: (args: { email: string; otp: string }) => Promise<AuthResult>;
  };
  emailOtp: {
    sendVerificationOtp: (args: { email: string; type: 'sign-in' }) => Promise<AuthResult>;
  };
  signOut: () => Promise<AuthResult>;
};

/**
 * Singleton Better Auth client — the app's session authority. Mirrors the server
 * plugins in convex/auth.ts: `crossDomain` (the SPA and Better Auth's routes live
 * on different origins, so the session travels as a Bearer token), `convex` (hands
 * the session to `ConvexBetterAuthProvider`), and `emailOTP` (passwordless email).
 *
 * `baseURL` is the `.convex.site` HTTP-routes origin. Prefer the runtime
 * `VITE_CONVEX_SITE_URL` (injected via `public/env.js` → `window.__ENV__`); fall
 * back to deriving it from `VITE_CONVEX_URL` (`.convex.cloud` → `.convex.site`).
 */
function siteBaseUrl(): string {
  const env = (typeof window !== 'undefined' && window.__ENV__) || {};
  const explicit = env.VITE_CONVEX_SITE_URL ?? import.meta.env.VITE_CONVEX_SITE_URL;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const convexUrl = String(env.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL ?? '');
  return convexUrl.replace(/\.convex\.cloud\/?$/, '.convex.site').replace(/\/+$/, '');
}

export const authClient: AuthClient & AppAuthSurface = createAuthClient({
  baseURL: siteBaseUrl(),
  plugins: [convexClient(), crossDomainClient(), emailOTPClient(), genericOAuthClient()],
});
