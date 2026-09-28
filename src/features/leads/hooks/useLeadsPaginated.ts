import { useEffect, useRef } from 'react';
import { useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { LeadFilters } from './useLeadFilters';

const PAGE_SIZE = 30;

// Residual filters apply per page, so a page can come back sparse: the hook fetches on to fill the screen, capped so a rare match never walks a huge table unasked.
const AUTO_FETCH_LIMIT = 10;

/** Also the exact `filter` shape createCampaign expects: the recipients of a campaign are resolved server-side from it. */
export function toFilterArgs(filters: LeadFilters) {
  const hasCustom = Object.keys(filters.customProperties).length > 0;
  return {
    search: filters.search || undefined,
    lifecycleStages: filters.lifecycleStages.length > 0 ? filters.lifecycleStages : undefined,
    companyIds: filters.companyIds.length > 0 ? filters.companyIds : undefined,
    ownerIds: filters.ownerIds.length > 0 ? filters.ownerIds : undefined,
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

/** Cursor pagination: the server reads one index-ordered page per request, never the whole table, so there is no exact filtered total and callers rely on `hasMore`. */
export function useLeadsPaginated(filters: LeadFilters) {
  const args = toQueryArgs(filters);
  // usePaginatedQuery resets its cursor when args change; the key only scopes the auto-fetch budget to the current filter and sort.
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

/** Every lead matching the current filter, for the live recipient preview of a campaign; the sort is irrelevant here and dropped. */
export function useMatchingLeads(filters: LeadFilters) {
  const { sortField, sortDirection, ...rest } = toQueryArgs(filters);
  void sortField;
  void sortDirection;
  return useAuthQuery(api.features.crm.queries.listMatchingLeadIds, rest);
}
