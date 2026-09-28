import { type ReactNode, useState } from 'react';
import { ConvexReactClient } from 'convex/react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { authClient } from '../auth/betterAuthClient';

interface ConvexProviderProps {
  children: ReactNode;
  url: string;
}

/** The Convex client carries the Better Auth session, so every query and mutation runs as the signed-in user. */
export function ConvexProvider({ children, url }: ConvexProviderProps) {
  const [client] = useState(() => new ConvexReactClient(url));

  return (
    <ConvexBetterAuthProvider client={client} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
