import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@crm/design-system';
import { useAuth } from './AuthContext';
import { usePublicConfig } from '../config';

function FullScreenSpinner({ testId }: { testId?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center" data-testid={testId}>
      <Spinner size="lg" />
    </div>
  );
}

// Latched at module load: Better Auth's cross-domain OAuth return appends a
// one-time `?ott=` token that ConvexBetterAuthProvider strips + redeems in an
// effect. Until that lands, useConvexAuth reports a *definitive* signed-out, so
// we keep showing the loading state to avoid flashing /login mid-exchange.
const oauthReturnPending =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('ott');
const OTT_REDEEM_TIMEOUT_MS = 8000;

/**
 * Gate rendered above ALL routes. On a fresh deployment (setup not complete) it
 * forces every visit to /setup; once setup is complete it keeps users off
 * /setup. Waits for the public config before deciding, so neither the login
 * page nor the wizard flashes on the wrong instance state.
 */
export function SetupGate() {
  const { config } = usePublicConfig();
  const { pathname } = useLocation();

  if (config === undefined) {
    return <FullScreenSpinner />;
  }

  if (!config.setupComplete && pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  if (config.setupComplete && pathname === '/setup') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/**
 * Gate for authenticated routes. Renders an <Outlet /> when the user is
 * authenticated, a spinner while the session resolves (including the OAuth
 * one-time-token redemption after a social redirect), and redirects to /login
 * otherwise.
 */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  const [ottTimedOut, setOttTimedOut] = useState(false);
  useEffect(() => {
    if (!oauthReturnPending || isAuthenticated) return;
    const timer = window.setTimeout(() => setOttTimedOut(true), OTT_REDEEM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated]);
  const redeemingOauth = oauthReturnPending && !isAuthenticated && !ottTimedOut;

  if (isLoading || redeemingOauth) {
    return <FullScreenSpinner testId="auth-spinner" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/**
 * Gate for public-only routes (e.g. /login). Redirects already-authenticated
 * users to `redirectTo` (default "/").
 */
export function PublicRoute({
  children,
  redirectTo = '/',
}: {
  children: ReactNode;
  redirectTo?: string;
}) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <FullScreenSpinner />;
  }

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
