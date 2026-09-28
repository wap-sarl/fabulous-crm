import { createAuthClient } from 'better-auth/react';
import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { emailOTPClient, genericOAuthClient } from 'better-auth/client/plugins';
import type { AuthClient } from '@convex-dev/better-auth/react';

type AuthResult = {
  data: unknown;
  error: { code?: string; message?: string; status?: number; statusText?: string } | null;
};

export type SocialProvider = 'google' | 'microsoft' | 'github' | 'linkedin';

/** Type guard narrowing a dynamic config id to a known social provider. */
export function isSocialProvider(id: string): id is SocialProvider {
  return id === 'google' || id === 'microsoft' || id === 'github' || id === 'linkedin';
}

/** Typed by hand: the client's inferred type cannot be named in declaration emit (TS7056, TS2883), so the export needs an explicit annotation. */
type AppAuthSurface = {
  signIn: {
    social: (args: {
      provider: SocialProvider;
      callbackURL?: string;
      errorCallbackURL?: string;
    }) => Promise<AuthResult>;
    // Custom SSO issuers go through the generic-oauth plugin: `providerId` is the slug stored in the server's `ssoProviders`.
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

/** The `.convex.site` origin of the HTTP routes: the runtime `VITE_CONVEX_SITE_URL` when set, else derived from `VITE_CONVEX_URL`. */
function siteBaseUrl(): string {
  const env = (typeof window !== 'undefined' && window.__ENV__) || {};
  const explicit = env.VITE_CONVEX_SITE_URL ?? import.meta.env.VITE_CONVEX_SITE_URL;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const convexUrl = String(env.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL ?? '');
  return convexUrl.replace(/\.convex\.cloud\/?$/, '.convex.site').replace(/\/+$/, '');
}

/** The plugins mirror the server's in convex/auth.ts; the SPA and Better Auth live on different origins, so the session travels as a Bearer token. */
export const authClient: AuthClient & AppAuthSurface = createAuthClient({
  baseURL: siteBaseUrl(),
  plugins: [convexClient(), crossDomainClient(), emailOTPClient(), genericOAuthClient()],
});
