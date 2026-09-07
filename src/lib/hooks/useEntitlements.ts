import { useMemo } from 'react';
import { eeFrontend } from '@crm/ee';
import { api } from '@crm/lib/backend';
import { useAuthQuery, usePublicConfig } from '@crm/widgets';
import type { EeFeature } from '../../../ee/contract';

export type Edition = 'ce' | 'saas';

/** Server truth once the public config is loaded; `VITE_EDITION` bridges the first render. */
export function useEdition(): Edition {
  const { config } = usePublicConfig();
  const fromEnv = window.__ENV__?.VITE_EDITION ?? import.meta.env.VITE_EDITION;
  return config?.edition ?? (fromEnv === 'saas' ? 'saas' : 'ce');
}

export function useEntitlements() {
  const state = useAuthQuery(api.features.config.queries.getEntitlements, {});
  return useMemo(() => {
    const features = state?.features ?? [];
    return {
      ...state,
      isLoading: state === undefined,
      features,
      /** Granted by the plan and shipped by this build: the only condition for showing a paid control. */
      canUse: (feature: EeFeature) =>
        features.includes(feature) && eeFrontend.features.includes(feature),
    };
  }, [state]);
}
