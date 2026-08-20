import { createContext, useContext, ReactNode } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';

export type PublicConfig = {
  setupComplete: boolean;
  organizationName: string;
  /** Resolved custom-branding URLs (null when the deployment uses defaults). */
  logoUrl: string | null;
  faviconUrl: string | null;
  /** Brand accent color (`#rrggbb`); null when the deployment uses the theme default. */
  primaryColor: string | null;
  /** `.convex.site` origin serving Better Auth routes; null if unavailable. */
  authCallbackBaseUrl: string | null;
  auth: {
    magicLink: boolean;
    /** Well-known providers; `configured` = credentials set via env. */
    socialProviders: { id: string; label: string; configured: boolean }[];
    /** Custom SSO issuers (Better Auth generic-oauth), configured in the DB like social. */
    customSsoProviders: { id: string; label: string }[];
  };
};

type ConfigContextValue = {
  /** undefined while the query is in flight. */
  config: PublicConfig | undefined;
};

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function usePublicConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('usePublicConfig must be used within a PublicConfigProvider');
  return ctx;
}

/**
 * Exposes the pre-auth public config (setup state + enabled login methods) to
 * the setup gate and login page. Reactive: when setup completes in another tab,
 * every consumer re-renders.
 */
export function PublicConfigProvider({ children }: { children: ReactNode }) {
  const config = useQuery(api.features.config.queries.getPublicConfig);
  return <ConfigContext.Provider value={{ config }}>{children}</ConfigContext.Provider>;
}
