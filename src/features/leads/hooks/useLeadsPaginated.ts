import { useEffect, useRef } from 'react';
import { useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { LeadFilters } from './useLeadFilters';

const PAGE_SIZE = 30;

// Residual filters (search, multi-selects, advanced filter…) are applied per
// page server-side, so a page can come back sparse — or empty — while more
// matches exist further in the table. The hook auto-fetches to fill the first
// screen, but caps the number of automatic fetches so a filter matching almost
// nothing on a huge table doesn't silently walk the whole table; past the cap,
// the user keeps going with the explicit "Charger plus".
const AUTO_FETCH_LIMIT = 10;

/**
 * Filter-only query args (no sort). Also the exact `filter` shape createCampaign
 * expects — campaign recipients are resolved server-side from this filter.
 */
export function toFilterArgs(filters: LeadFilters) {
  const hasCustom = Object.keys(filters.customProperties).length > 0;
  return {
    search: filters.search || undefined,
    statuses: filters.statuses.length > 0 ? filters.statuses : undefined,
    lifecycleStages: filters.lifecycleStages.length > 0 ? filters.lifecycleStages : undefined,
    companyIds: filters.companyIds.length > 0 ? filters.companyIds : undefined,
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
 * Leads list driven by the URL filter/sort state, on real cursor pagination
 * (#11): the server reads one index-ordered page per request and applies the
 * residual filters to it — the table is never read whole. There is no exact
 * filtered total anymore (that needs the aggregates issue); callers gate
 * "Charger plus" on `hasMore`.
 */
export function useLeadsPaginated(filters: LeadFilters) {
  const args = toQueryArgs(filters);
  // usePaginatedQuery resets its cursor when args change; the key just scopes
  // our auto-fetch budget to the current filter/sort selection.
  const filterKey = JSON.stringify(args);

  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.crm.queries.listLeadsPaginated,
    args,
    { initialNumItems: PAGE_SIZE },
  );

  const autoFetches = useRef({ key: filterKey, count: 0 });
  if (autoFetches.current.key !== filterKey) {
    autoFetches.current = { key: filterKey, count: 0 };
  }
  useEffect(() => {
    if (
      status === 'CanLoadMore' &&
      results.length < PAGE_SIZE &&
      autoFetches.current.count < AUTO_FETCH_LIMIT
    ) {
      autoFetches.current.count++;
      loadMore(PAGE_SIZE);
    }
  }, [status, results.length, loadMore]);

  return {
    results,
    isLoading: status === 'LoadingFirstPage',
    hasMore: status === 'CanLoadMore',
    loadMore: () => {
      // A manual click re-opens the auto-fetch budget for the next screenful.
      autoFetches.current.count = 0;
      loadMore(PAGE_SIZE);
    },
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
