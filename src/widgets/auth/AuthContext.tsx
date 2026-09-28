import type { ReactNode } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import { authClient } from './betterAuthClient';

/** Better Auth is the session authority: no token and no localStorage here, the session lives in its client. */
export function useAuth() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.auth.getCurrentUser, isAuthenticated ? {} : 'skip');

  return {
    user: user ?? null,
    // An authenticated session is still loading until its employee is fetched.
    isLoading: isLoading || (isAuthenticated && user === undefined),
    // A Better Auth user with no employee row is not a valid CRM user.
    isAuthenticated: isAuthenticated && !!user,
    logout: () => authClient.signOut(),
  };
}

/** A passthrough that keeps the `<AuthProvider>` mounts working: the auth state comes from `ConvexBetterAuthProvider`. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
