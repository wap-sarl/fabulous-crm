import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthPaginatedQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type {
  DealAdvancedFilter,
  DealRow,
  DealStandardField,
  DealStatus,
  Id,
} from '@crm/lib/backend';
import {
  Button,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@crm/design-system';
import { ChevronRight, Search } from 'lucide-react';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { DEAL_STATUSES, DEAL_STATUS_TONE, formatMoney } from '../../../lib/constants';
import { usePipelines } from '../hooks/usePipelines';
import { dealFieldCatalog } from '../lib/dealFilters';
import { AdvancedFilterBuilder } from '../../filters/components/AdvancedFilterBuilder';
import { parseAdvancedFilter, serializeAdvancedFilter } from '../../filters/lib/advancedFilter';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { formatPropertyValue } from '../../properties/lib/customProperties';
import { dateFormat } from '@crm/lib/format';

const ALL = '__all__';
const LIST_PAGE = 30;
const SKELETON_ROWS = ['s1', 's2', 's3', 's4', 's5'];

/** Filterable list view of a pipeline's deals (or every pipeline). */
export function DealsList({
  pipelineId,
  onOpen,
}: {
  pipelineId: Id<'pipelines'> | undefined;
  onOpen: (deal: DealRow) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const owner = searchParams.get('owner') ?? '';
  const [searchInput, setSearchInput] = useState(search);
  const { employees } = useEmployees();
  const { pipelines } = usePipelines();
  const definitions = usePropertyDefinitions('deal');
  const visibleCols = definitions.filter((d) => d.showInTable);
  const advancedFilter = useMemo(
    () => parseAdvancedFilter<DealStandardField>(searchParams.get('af')),
    [searchParams],
  );
  const setAdvancedFilter = (next: DealAdvancedFilter | undefined) =>
    setParam('af', serializeAdvancedFilter(next) ?? '');

  useEffect(() => setSearchInput(search), [search]);
  const setParam = (key: string, value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput === search) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (searchInput) next.set('q', searchInput);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, search, setSearchParams]);

  const {
    results,
    status: loadStatus,
    loadMore,
  } = useAuthPaginatedQuery(
    api.features.deals.queries.listDealsPaginated,
    {
      pipelineId,
      statuses: status ? [status as DealStatus] : undefined,
      ownerIds: owner ? [owner as Id<'users'>] : undefined,
      search: search || undefined,
      advancedFilter,
    },
    { initialNumItems: LIST_PAGE },
  );
  const colSpan = 7 + visibleCols.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder" />
          <Input
            type="search"
            placeholder="Rechercher un intitulé…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-64 pl-9"
          />
        </div>
        <SegmentedControl
          aria-label="Filtrer par statut"
          items={[
            { value: ALL, label: 'Toutes' },
            ...DEAL_STATUSES.map((s) => ({ value: s.value, label: s.label })),
          ]}
          value={status || ALL}
          onChange={(v) => setParam('status', v === ALL ? '' : v)}
        />
        <Select value={owner || ALL} onValueChange={(v) => setParam('owner', v === ALL ? '' : v)}>
          <SelectTrigger className="w-52" aria-label="Filtrer par propriétaire">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les propriétaires</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e._id} value={e._id}>
                {e.firstName} {e.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AdvancedFilterBuilder
          filter={advancedFilter}
          onChange={setAdvancedFilter}
          catalog={dealFieldCatalog(pipelines, definitions)}
        />
      </div>

      <div className="rounded-xl border bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Transaction</TableHead>
              <TableHead>Stade</TableHead>
              <TableHead>Montant</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Propriétaire</TableHead>
              {visibleCols.map((def) => (
                <TableHead key={def._id}>{def.label}</TableHead>
              ))}
              <TableHead>Clôture</TableHead>
              <TableHead className="w-10" aria-label="Ouvrir" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadStatus === 'LoadingFirstPage' ? (
              SKELETON_ROWS.map((row) => (
                <TableRow key={row} className="hover:bg-transparent">
                  <TableCell colSpan={colSpan} className="py-3">
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : results.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-faint">
                  Aucune transaction.
                </TableCell>
              </TableRow>
            ) : (
              results.map((deal) => (
                <TableRow
                  key={deal._id}
                  className="cursor-pointer"
                  onClick={() => onOpen(deal)}
                  data-testid="deal-row"
                >
                  <TableCell className="text-sm font-semibold text-ink">{deal.title}</TableCell>
                  <TableCell>
                    <StatusBadge tone={DEAL_STATUS_TONE[deal.status]}>
                      {deal.stageLabel}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-mono text-[12.5px] text-soft">
                    {formatMoney(deal.amount, deal.currency)}
                  </TableCell>
                  <TableCell className="text-[13px] text-soft">{deal.leadName ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-soft">
                    {deal.ownerNames.join(', ') || '—'}
                  </TableCell>
                  {visibleCols.map((def) => (
                    <TableCell key={def._id} className="text-[13px] text-soft">
                      {formatPropertyValue(def, deal.customProperties?.[def._id])}
                    </TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap font-mono text-[12.5px] text-soft">
                    {deal.expectedCloseDate
                      ? dateFormat.format(new Date(deal.expectedCloseDate))
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-[#C8CCD4]" aria-hidden />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {loadStatus === 'CanLoadMore' && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={() => loadMore(LIST_PAGE)}>
            Charger plus
          </Button>
        </div>
      )}
    </div>
  );
}
