import { useState, useEffect } from 'react';
import {
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import { Search } from 'lucide-react';
import type { LeadStatus } from '@crm/lib/backend';
import { LEAD_STATUSES } from '../../../lib/constants';
import type { LeadFilters } from '../hooks/useLeadFilters';
import { useLifecycleConfig } from '../hooks/useLifecycleConfig';

const ALL_STAGES = '__all__';

interface LeadsToolbarProps {
  filters: LeadFilters;
  setParam: (key: string, value: string | string[] | boolean | undefined) => void;
  /** Global lead counts per status, for the segmented chips. */
  statusCounts?: Partial<Record<LeadStatus | 'all', number>>;
  /** Global live lead counts per lifecycle stage key, for the stage dropdown. */
  lifecycleCounts?: Record<string, number>;
}

export function LeadsToolbar({
  filters,
  setParam,
  statusCounts,
  lifecycleCounts,
}: LeadsToolbarProps) {
  const [searchInput, setSearchInput] = useState(filters.search);
  const lifecycle = useLifecycleConfig();

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

      <Select
        value={filters.lifecycleStages.length === 1 ? filters.lifecycleStages[0] : ALL_STAGES}
        onValueChange={(v) => setParam('lifecycle', v === ALL_STAGES ? undefined : v)}
      >
        <SelectTrigger className="w-56" aria-label="Filtrer par statut du lead">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_STAGES}>Status</SelectItem>
          {lifecycle.stages.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              {s.label}
              {lifecycleCounts ? ` (${lifecycleCounts[s.key] ?? 0})` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
