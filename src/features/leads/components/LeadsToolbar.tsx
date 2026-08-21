import { useState, useEffect } from 'react';
import { Input, SegmentedControl } from '@crm/design-system';
import { Search } from 'lucide-react';
import type { LeadStatus } from '@crm/lib/backend';
import { LEAD_STATUSES } from '../../../lib/constants';
import type { LeadFilters } from '../hooks/useLeadFilters';

interface LeadsToolbarProps {
  filters: LeadFilters;
  setParam: (key: string, value: string | string[] | boolean | undefined) => void;
  /** Global lead counts per status, for the segmented chips. */
  statusCounts?: Partial<Record<LeadStatus | 'all', number>>;
}

export function LeadsToolbar({ filters, setParam, statusCounts }: LeadsToolbarProps) {
  const [searchInput, setSearchInput] = useState(filters.search);

  // Keep local input in sync when the URL changes externally (e.g. back button)
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  // Debounce search → URL
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== filters.search) setParam('q', searchInput);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, filters.search, setParam]);

  // The segmented control is single-select; multi-status URLs (legacy) fall
  // back to highlighting « Tous ».
  const segmentedValue = filters.statuses.length === 1 ? filters.statuses[0] : 'all';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder" />
        <Input
          type="search"
          placeholder="Rechercher (nom, e-mail…)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-72 pl-9"
          data-testid="leads-search"
        />
      </div>

      <SegmentedControl
        aria-label="Filtrer par statut"
        items={[
          { value: 'all', label: 'Tous', count: statusCounts?.all },
          ...LEAD_STATUSES.map((s) => ({
            value: s.value as string,
            label: s.label,
            count: statusCounts?.[s.value],
          })),
        ]}
        value={segmentedValue}
        onChange={(v) => setParam('status', v === 'all' ? undefined : v)}
      />
    </div>
  );
}
