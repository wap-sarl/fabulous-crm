import type { ReactNode } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import { authClient } from './betterAuthClient';

/**
 * Auth state, backed entirely by Better Auth (the session authority):
 * `useConvexAuth()` for the session, and `api.auth.getCurrentUser` for the linked
 * app employee (role, name…). No token, no localStorage — the session lives in
 * the Better Auth client and is set on the Convex client by ConvexBetterAuthProvider.
 */
export function useAuth() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.auth.getCurrentUser, isAuthenticated ? {} : 'skip');

  return {
    user: user ?? null,
    // Still loading while the session resolves, or while we fetch the employee
    // for an authenticated session.
    isLoading: isLoading || (isAuthenticated && user === undefined),
    // Authenticated only once we have a linked employee (a Better Auth user with
    // no employee row is not a valid CRM user).
    isAuthenticated: isAuthenticated && !!user,
    logout: () => authClient.signOut(),
  };
}

/**
 * Retained as a passthrough so existing `<AuthProvider>` mounts keep working;
 * auth state now comes from `ConvexBetterAuthProvider` (see providers/ConvexProvider).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
