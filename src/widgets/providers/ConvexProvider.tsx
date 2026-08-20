import { ReactNode, useState } from 'react';
import { ConvexReactClient } from 'convex/react';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { authClient } from '../auth/betterAuthClient';

interface ConvexProviderProps {
  children: ReactNode;
  url: string;
}

/**
 * Convex client authenticated by Better Auth. `ConvexBetterAuthProvider` reads
 * the session from `authClient` and sets it on the Convex client, so every
 * `useQuery`/`useMutation` runs as the signed-in user and `useConvexAuth()`
 * reflects auth state.
 */
export function ConvexProvider({ children, url }: ConvexProviderProps) {
  const [client] = useState(() => new ConvexReactClient(url));

  return (
    <ConvexBetterAuthProvider client={client} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
