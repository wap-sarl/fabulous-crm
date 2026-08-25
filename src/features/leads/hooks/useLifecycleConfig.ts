import { useMemo } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { LifecycleConfig } from '@crm/lib/backend';
import { DEFAULT_LIFECYCLE_CONFIG } from '@crm/lib/backend';

export interface LifecycleConfigView extends LifecycleConfig {
  /** Label of a stage key; the raw key for stages removed from the config. */
  labelOf: (key: string | null | undefined) => string;
  /** Funnel position of a stage key (-1 when unknown). */
  indexOf: (key: string | null | undefined) => number;
  isLoading: boolean;
}

export function useLifecycleConfig(): LifecycleConfigView {
  const config = useAuthQuery(api.features.config.queries.getLifecycleConfig, {});
  return useMemo(() => {
    const resolved = config ?? DEFAULT_LIFECYCLE_CONFIG;
    const labels = new Map(resolved.stages.map((s) => [s.key, s.label]));
    const indexes = new Map(resolved.stages.map((s, i) => [s.key, i]));
    return {
      ...resolved,
      labelOf: (key) => (key ? (labels.get(key) ?? key) : '—'),
      indexOf: (key) => (key ? (indexes.get(key) ?? -1) : -1),
      isLoading: config === undefined,
    };
  }, [config]);
}
