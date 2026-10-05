import { useEffect, useState } from 'react';
import { useConvex, useConvexAuth } from 'convex/react';
import type { FunctionArgs } from 'convex/server';
import { api } from '@crm/lib/backend';
import { countMatchingLeads, type MatchingLeadCount } from '../lib/matchingLeads';

type MatchingFilters = Omit<
  FunctionArgs<typeof api.features.leads.queries.matchingLeadsPage>,
  'cursor'
>;

/** How many leads match a filter, counted page after page when the filter changes; `undefined` while it counts. A live query would read the whole table, and again at every write of a lead. */
export function useMatchingLeadCount(
  filters: MatchingFilters | 'skip',
): MatchingLeadCount | undefined {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  // The filter as text: the object is a new one at every render.
  const key = filters === 'skip' || !isAuthenticated ? null : JSON.stringify(filters);
  const [state, setState] = useState<{ key: string; count: MatchingLeadCount } | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: unknown } | null>(null);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const wanted: MatchingFilters = JSON.parse(key);
    countMatchingLeads(
      (cursor) => convex.query(api.features.leads.queries.matchingLeadsPage, { ...wanted, cursor }),
      () => cancelled,
    ).then(
      (count) => {
        if (count) setState({ key, count });
      },
      (error) => {
        if (!cancelled) setFailure({ key, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [convex, key]);

  // As a live query does, a failure is the page's, not a count that never comes; it is that of its filter only, so another filter counts again.
  if (failure && failure.key === key) throw failure.error;
  return state && state.key === key ? state.count : undefined;
}
