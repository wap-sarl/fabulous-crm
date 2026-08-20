import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { WorkflowStatus } from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import {
  Button,
  Input,
  PageHeader,
  SegmentedControl,
  Spinner,
  StatusBadge,
} from '@crm/design-system';
import { Calendar, Plus, Search, Layers, Zap } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import {
  TRIGGER_TYPE_LABEL,
  WORKFLOW_STATUSES,
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_STATUS_TONE,
} from '../../features/workflows/lib/constants';

const numberFormat = new Intl.NumberFormat('fr-FR');

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ms));
}

export function WorkflowsPage() {
  usePageTitle('Workflows');
  const navigate = useNavigate();
  const workflows = useAuthQuery(api.features.workflows.queries.listWorkflows, {});

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkflowStatus>('all');

  const filtered = useMemo(() => {
    if (!workflows) return [];
    const q = search.trim().toLowerCase();
    return workflows.filter(
      (w) =>
        (statusFilter === 'all' || w.status === statusFilter) &&
        (q === '' || w.name.toLowerCase().includes(q))
    );
  }, [workflows, search, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<'all' | WorkflowStatus, number>> = {
      all: workflows?.length ?? 0,
    };
    for (const w of workflows ?? []) {
      counts[w.status] = (counts[w.status] ?? 0) + 1;
    }
    return counts;
  }, [workflows]);

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title="Workflows"
        subtitle={workflows ? `${workflows.length} workflow(s)` : 'Chargement…'}
        actions={
          <Button onClick={() => navigate('/workflows/new')} data-testid="new-workflow">
            <Plus className="h-4 w-4" />
            Nouveau workflow
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-5 pb-6 sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder" />
            <Input
              type="search"
              placeholder="Rechercher un workflow"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64 pl-9"
            />
          </div>
          <SegmentedControl
            aria-label="Filtrer par statut"
            items={[
              { value: 'all', label: 'Tous', count: statusCounts.all },
              ...WORKFLOW_STATUSES.map((s) => ({
                value: s.value as string,
                label: s.label,
                count: statusCounts[s.value] ?? 0,
              })),
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as 'all' | WorkflowStatus)}
          />
        </div>

        {workflows === undefined ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border bg-card py-14 text-center text-faint shadow-card">
            Aucun workflow.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(336px,1fr))] gap-4">
            {filtered.map((w) => (
              <button
                key={w._id}
                type="button"
                data-testid="workflow-row"
                onClick={() => navigate(`/workflows/${w._id}`)}
                className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-card transition-all hover:border-[#DADDE4] hover:shadow-card-hover"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary">
                    <Zap className="size-3.5" />
                    {TRIGGER_TYPE_LABEL[w.triggerType]}
                  </span>
                  <StatusBadge tone={WORKFLOW_STATUS_TONE[w.status]}>
                    {WORKFLOW_STATUS_LABEL[w.status]}
                  </StatusBadge>
                </div>

                <div className="truncate text-base font-bold text-ink">{w.name}</div>

                <div className="flex items-center gap-4 text-[12.5px] text-faint">
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="size-3.5" />
                    {w.nodeCount} étape(s)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="size-3.5" />
                    {formatDate(w._creationTime)}
                  </span>
                </div>

                <div className="h-px bg-[#F1F2F5]" />

                <div className="flex gap-5">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                      Inscrits
                    </div>
                    <div className="font-mono text-[15px] font-bold text-ink">
                      {numberFormat.format(w.enrolledCount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                      En cours
                    </div>
                    <div className="font-mono text-[15px] font-bold text-ink">
                      {numberFormat.format(w.activeCount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                      Terminés
                    </div>
                    <div className="font-mono text-[15px] font-bold text-ink">
                      {numberFormat.format(w.completedCount)}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
