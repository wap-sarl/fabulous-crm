import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Guest token context for the public consent/lead flow (unrelated to auth — that
 * is owned by Better Auth). Supplies the `guestToken` injected by the guest hooks.
 */
interface TokenContextValue {
  guestToken: string | null;
}

const TokenContext = createContext<TokenContextValue>({ guestToken: null });

interface TokenProviderProps {
  guestToken?: string | null;
  children: ReactNode;
}

export function TokenProvider({ guestToken = null, children }: TokenProviderProps) {
  const value = useMemo(() => ({ guestToken }), [guestToken]);
  return <TokenContext.Provider value={value}>{children}</TokenContext.Provider>;
}

export function useGuestToken(): string | null {
  return useContext(TokenContext).guestToken;
}
