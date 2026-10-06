import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Doc, Id } from '@crm/lib/backend';

const NONE: never[] = [];

/** Creates the stock pipeline the first time the deals feature is opened on an instance that has none. */
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

  // What is returned keeps its identity while the pipelines do: the callers memoise on it.
  const loaded = (pipelines ?? NONE) as Doc<'pipelines'>[];
  const byId = useMemo(() => new Map(loaded.map((p) => [p._id as string, p])), [loaded]);
  const stageLabel = useCallback(
    (pipelineId: Id<'pipelines'> | string, stageKey: string) =>
      byId.get(pipelineId as string)?.stages.find((s) => s.key === stageKey)?.label ?? stageKey,
    [byId],
  );
  return {
    pipelines: loaded,
    isLoading: pipelines === undefined,
    byId,
    defaultPipeline: loaded.find((p) => p.isDefault) ?? loaded[0] ?? null,
    stageLabel,
  };
}
