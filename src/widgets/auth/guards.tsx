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

// Latched at module load: until the one-time `?ott=` token of an OAuth return is redeemed, useConvexAuth reports signed-out and /login would flash.
const oauthReturnPending =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('ott');
const OTT_REDEEM_TIMEOUT_MS = 8000;

/** Sits above all routes and waits for the public config before deciding, so neither the login page nor the wizard flashes. */
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

/** The spinner also covers the redemption of the OAuth one-time token, bounded by a timeout so a dead token ends on /login. */
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
