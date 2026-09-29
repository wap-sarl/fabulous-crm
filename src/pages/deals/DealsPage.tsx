import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { DealRow, PipelineStage } from '@crm/lib/backend';
import {
  Button,
  PageHeader,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@crm/design-system';
import { Plus, Upload } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { formatMoney } from '../../lib/constants';
import { DealFormDialog } from '../../features/deals/components/DealFormDialog';
import { DealKanban } from '../../features/deals/components/DealKanban';
import { usePipelines } from '../../features/deals/hooks/usePipelines';
import { useStageMove } from '../../features/deals/components/StageMoveDialog';
import { DealsList } from '../../features/deals/components/DealsList';

export function DealsPage() {
  usePageTitle('Transactions');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pipelines, isLoading, byId, defaultPipeline } = usePipelines();
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

  const { requestMove, dialog: stageMoveDialog } = useStageMove();
  const handleMove = async (deal: DealRow, stage: PipelineStage) => requestMove(deal, stage);

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
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/import?entity=deal')}>
              <Upload className="h-4 w-4" />
              Importer
            </Button>
            <Button onClick={() => setFormOpen(true)} data-testid="new-deal" disabled={!pipeline}>
              <Plus className="h-4 w-4" />
              Nouvelle transaction
            </Button>
          </div>
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

      {stageMoveDialog}
      <DealFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaults={{ pipelineId: pipeline?._id }}
        onCreated={(id) => navigate(`/deals/${id}`)}
      />
    </div>
  );
}
