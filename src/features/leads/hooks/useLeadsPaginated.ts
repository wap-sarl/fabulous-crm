import { useEffect, useRef, useState } from 'react';
import type { FunctionReturnType } from 'convex/server';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { LeadFilters } from './useLeadFilters';

const PAGE_SIZE = 30;

type LeadsResult = FunctionReturnType<typeof api.features.crm.queries.listLeadsPaginated>;

/**
 * Filter-only query args (no sort). Also the exact `filter` shape createCampaign
 * expects — campaign recipients are resolved server-side from this filter.
 */
export function toFilterArgs(filters: LeadFilters) {
  const hasCustom = Object.keys(filters.customProperties).length > 0;
  return {
    search: filters.search || undefined,
    statuses: filters.statuses.length > 0 ? filters.statuses : undefined,
    assignedToIds: filters.assignedToIds.length > 0 ? filters.assignedToIds : undefined,
    listIds: filters.listIds.length > 0 ? filters.listIds : undefined,
    isRedFlagged: filters.flagged,
    customProperties: hasCustom ? filters.customProperties : undefined,
    advancedFilter: filters.advancedFilter,
  };
}

function toQueryArgs(filters: LeadFilters) {
  return {
    ...toFilterArgs(filters),
    sortField: filters.sortField,
    sortDirection: filters.sortDirection,
  };
}

/**
 * Leads list driven by the URL filter/sort state. The server filters the whole
 * table in one pass and returns the first `limit` matches plus the total count;
 * "Charger plus" grows the window client-side.
 */
export function useLeadsPaginated(filters: LeadFilters) {
  const args = toQueryArgs(filters);
  // Identifies the filter/sort selection independent of the paging window, so we
  // can reset the window (and know when cached rows belong to the current view).
  const filterKey = JSON.stringify(args);

  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [filterKey]);

  const data = useAuthQuery(api.features.crm.queries.listLeadsPaginated, { ...args, limit });

  // Retain the last results for the *current* filter so growing the window
  // doesn't flash the table back to its loading state on every "Charger plus".
  const cache = useRef<{ key: string; data: LeadsResult } | null>(null);
  if (data !== undefined) cache.current = { key: filterKey, data };
  const fresh = cache.current?.key === filterKey ? cache.current.data : null;

  const results = data?.page ?? fresh?.page ?? [];
  const total = data?.total ?? fresh?.total;

  return {
    results,
    total,
    // Loading only when there is nothing to show for the current filter (initial
    // load or a filter change) — not while paging in more rows we already have.
    isLoading: data === undefined && !fresh,
    hasMore: total !== undefined && results.length < total,
    loadMore: () => setLimit((l) => l + PAGE_SIZE),
  };
}

/**
 * Reactively resolve every lead matching the current filter (for building a
 * campaign "from this filter"). Returns the ids plus counts (total / with email)
 * for a live recipient preview. Sort args are irrelevant here and dropped.
 */
export function useMatchingLeads(filters: LeadFilters) {
  const { sortField, sortDirection, ...rest } = toQueryArgs(filters);
  void sortField;
  void sortDirection;
  return useAuthQuery(api.features.crm.queries.listMatchingLeadIds, rest);
}
