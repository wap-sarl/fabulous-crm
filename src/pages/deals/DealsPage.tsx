import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type {
  DealAdvancedFilter,
  DealRow,
  DealStandardField,
  DealStatus,
  Id,
  PipelineStage,
} from '@crm/lib/backend';
import {
  Button,
  Input,
  PageHeader,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@crm/design-system';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useEmployees } from '../../lib/hooks/useEmployees';
import { DEAL_STATUSES, DEAL_STATUS_TONE, formatMoney } from '../../lib/constants';
import { DealFormDialog } from '../../features/deals/components/DealFormDialog';
import { DealKanban } from '../../features/deals/components/DealKanban';
import { useDealActions } from '../../features/deals/hooks/useDealActions';
import { usePipelines } from '../../features/deals/hooks/usePipelines';
import { dealErrorMessage } from '../../features/deals/lib/errors';
import { dealFieldCatalog } from '../../features/deals/lib/dealFilters';
import { AdvancedFilterBuilder } from '../../features/filters/components/AdvancedFilterBuilder';
import {
  parseAdvancedFilter,
  serializeAdvancedFilter,
} from '../../features/filters/lib/advancedFilter';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';
import { formatPropertyValue } from '../../features/properties/lib/customProperties';

const ALL = '__all__';
const LIST_PAGE = 30;
const SKELETON_ROWS = ['s1', 's2', 's3', 's4', 's5'];
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

/** Filterable list view of a pipeline's deals (or every pipeline). */
function DealsList({
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
                  <TableCell className="text-[13px] text-soft">{deal.ownerName ?? '—'}</TableCell>
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

export function DealsPage() {
  usePageTitle('Transactions');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pipelines, isLoading, byId, defaultPipeline } = usePipelines();
  const { moveDealStage } = useDealActions();
  const [formOpen, setFormOpen] = useState(false);

  const view = searchParams.get('view') === 'list' ? 'list' : 'kanban';
  const pipelineParam = searchParams.get('pipeline');
  const pipeline =
    (pipelineParam ? byId.get(pipelineParam) : undefined) ?? defaultPipeline ?? undefined;
  const stats = useAuthQuery(
    api.features.deals.queries.getPipelineStats,
    pipeline ? { pipelineId: pipeline._id } : 'skip',
  );
  const totals = useMemo(
    () =>
      Object.fromEntries(
        (stats?.stages ?? []).map((s) => [s.key, { count: s.count, amount: s.amount }]),
      ),
    [stats],
  );

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

  const handleMove = async (deal: DealRow, stage: PipelineStage) => {
    try {
      await moveDealStage({ dealId: deal._id, stageKey: stage.key });
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Impossible de déplacer la transaction.'));
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title="Transactions"
        subtitle={
          stats
            ? `${stats.open.count} en cours · ${formatMoney(stats.open.amount, 'EUR')} · ${stats.won.count} gagnée(s)`
            : undefined
        }
        actions={
          <Button onClick={() => setFormOpen(true)} data-testid="new-deal" disabled={!pipeline}>
            <Plus className="h-4 w-4" />
            Nouvelle transaction
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-5 pb-6 sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={pipeline?._id ?? ''}
            onValueChange={(v) => setParam('pipeline', v)}
            disabled={pipelines.length === 0}
          >
            <SelectTrigger className="w-64" aria-label="Pipeline" data-testid="pipeline-select">
              <SelectValue placeholder="Pipeline…" />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SegmentedControl
            aria-label="Vue"
            items={[
              { value: 'kanban', label: 'Kanban' },
              { value: 'list', label: 'Liste' },
            ]}
            value={view}
            onChange={(v) => setParam('view', v === 'kanban' ? '' : v)}
          />
        </div>

        {isLoading || !pipeline ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : view === 'kanban' ? (
          <DealKanban
            pipeline={pipeline}
            totals={totals}
            onOpen={(deal) => navigate(`/deals/${deal._id}`)}
            onMove={handleMove}
          />
        ) : (
          <DealsList pipelineId={pipeline._id} onOpen={(deal) => navigate(`/deals/${deal._id}`)} />
        )}
      </div>

      <DealFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaults={{ pipelineId: pipeline?._id }}
        onCreated={(id) => navigate(`/deals/${id}`)}
      />
    </div>
  );
}
