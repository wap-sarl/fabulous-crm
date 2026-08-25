import { useEffect, useMemo, useRef } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Doc, Id } from '@crm/lib/backend';

/**
 * The instance's pipelines (default first). Creates the stock pipeline the
 * first time the deals feature is opened on an instance that has none.
 */
export function usePipelines() {
  const pipelines = useAuthQuery(api.features.deals.queries.listPipelines, {});
  const ensureDefault = useAuthMutation(api.features.deals.mutations.ensureDefaultPipeline);
  const requested = useRef(false);
  useEffect(() => {
    if (pipelines && pipelines.length === 0 && !requested.current) {
      requested.current = true;
      void ensureDefault({}).catch(() => {
        requested.current = false;
      });
    }
  }, [pipelines, ensureDefault]);

  const byId = useMemo(
    () => new Map((pipelines ?? []).map((p) => [p._id as string, p])),
    [pipelines],
  );
  return {
    pipelines: (pipelines ?? []) as Doc<'pipelines'>[],
    isLoading: pipelines === undefined,
    byId,
    defaultPipeline: (pipelines ?? []).find((p) => p.isDefault) ?? pipelines?.[0] ?? null,
    stageLabel: (pipelineId: Id<'pipelines'> | string, stageKey: string) =>
      byId.get(pipelineId as string)?.stages.find((s) => s.key === stageKey)?.label ?? stageKey,
  };
}
