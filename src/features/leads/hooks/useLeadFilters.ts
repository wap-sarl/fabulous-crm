import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AdvancedFilter, Id, LeadStatus } from '@crm/lib/backend';
import { parseAdvancedFilter, serializeAdvancedFilter } from '../lib/advancedFilter';

export type LeadSortField = 'recent' | 'lastName' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface LeadFilters {
  search: string;
  statuses: LeadStatus[];
  /** Lifecycle stage keys (appConfig.lifecycle); a lead matches any (OR). */
  lifecycleStages: string[];
  assignedToIds: Id<'users'>[];
  /** Lead lists to filter by; a lead matches if it belongs to any (OR). */
  listIds: Id<'leadLists'>[];
  /** undefined = all leads, true = only flagged, false = only non-flagged */
  flagged: boolean | undefined;
  /**
   * Custom-property filters, keyed by definition id → allowed values. Select
   * properties hold option-value strings; boolean properties hold a single
   * true/false. Serialized in the URL as `cps_<id>` (CSV) / `cpb_<id>`
   * (`true`/`false`) so the type is recoverable without the definitions.
   */
  customProperties: Record<string, (string | boolean)[]>;
  /** Advanced group-based filter (JSON-serialized in the `af` URL param). */
  advancedFilter: AdvancedFilter | undefined;
  sortField: LeadSortField;
  sortDirection: SortDirection;
}

/** URL param prefixes for custom-property filters (select vs boolean). */
export const CP_SELECT_PREFIX = 'cps_';
export const CP_BOOLEAN_PREFIX = 'cpb_';

const VALID_STATUSES: LeadStatus[] = ['nouveau', 'contacte', 'interesse', 'converti', 'perdu'];
const VALID_SORT: LeadSortField[] = ['recent', 'lastName', 'status'];

function csv(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

/**
 * Reads and writes the leads-table filter + sort state from the URL query
 * params, so filters/sort are shareable and survive reload.
 */
export function useLeadFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<LeadFilters>(() => {
    const rawStatuses = csv(searchParams.get('status')).filter((s): s is LeadStatus =>
      VALID_STATUSES.includes(s as LeadStatus),
    );
    const sortParam = searchParams.get('sort');
    const sortField = VALID_SORT.includes(sortParam as LeadSortField)
      ? (sortParam as LeadSortField)
      : 'recent';
    const flaggedParam = searchParams.get('flagged');

    const customProperties: Record<string, (string | boolean)[]> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith(CP_SELECT_PREFIX)) {
        const vals = csv(value);
        if (vals.length > 0) customProperties[key.slice(CP_SELECT_PREFIX.length)] = vals;
      } else if (key.startsWith(CP_BOOLEAN_PREFIX)) {
        if (value === 'true') customProperties[key.slice(CP_BOOLEAN_PREFIX.length)] = [true];
        else if (value === 'false') customProperties[key.slice(CP_BOOLEAN_PREFIX.length)] = [false];
      }
    }

    return {
      search: searchParams.get('q') ?? '',
      statuses: rawStatuses,
      lifecycleStages: csv(searchParams.get('lifecycle')),
      assignedToIds: csv(searchParams.get('assigned')) as Id<'users'>[],
      listIds: csv(searchParams.get('lists')) as Id<'leadLists'>[],
      flagged: flaggedParam === 'true' ? true : flaggedParam === 'false' ? false : undefined,
      customProperties,
      advancedFilter: parseAdvancedFilter(searchParams.get('af')),
      sortField,
      sortDirection: searchParams.get('dir') === 'asc' ? 'asc' : 'desc',
    };
  }, [searchParams]);

  const setParam = useCallback(
    (key: string, value: string | string[] | boolean | undefined) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const serialized = Array.isArray(value) ? value.join(',') : value;
          if (serialized === undefined || serialized === '' || serialized === false) {
            next.delete(key);
          } else {
            next.set(key, String(serialized));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setAdvancedFilter = useCallback(
    (next: AdvancedFilter | undefined) => {
      const serialized = serializeAdvancedFilter(next);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (serialized === undefined) p.delete('af');
          else p.set('af', serialized);
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const toggleSort = useCallback(
    (field: LeadSortField) => {
      const isSame = filters.sortField === field;
      const nextDir: SortDirection = isSame && filters.sortDirection === 'desc' ? 'asc' : 'desc';
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('sort', field);
          next.set('dir', nextDir);
          return next;
        },
        { replace: true },
      );
    },
    [filters.sortField, filters.sortDirection, setSearchParams],
  );

  return { filters, setParam, setAdvancedFilter, toggleSort };
}
