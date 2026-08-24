import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { Id, WorkflowRunStatus } from '@crm/lib/backend';
import { useAuthMutation, useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import {
  Button,
  KeyValueList,
  KeyValueRow,
  PageHeader,
  SegmentedControl,
  Spinner,
  StatCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@crm/design-system';
import { CheckCircle2, Pause, Pencil, Play, Trash2, Users, XCircle, Zap } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { countActiveRules } from '../../features/leads/lib/advancedFilter';
import { RunDetailSheet } from '../../features/workflows/components/RunDetailSheet';
import {
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  TRIGGER_TYPE_LABEL,
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_STATUS_TONE,
  triggerLabel,
} from '../../features/workflows/lib/constants';

const numberFormat = new Intl.NumberFormat('fr-FR');
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const RUN_FILTERS: { value: 'all' | WorkflowRunStatus; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'En cours' },
  { value: 'completed', label: 'Terminés' },
  { value: 'failed', label: 'Échecs' },
  { value: 'cancelled', label: 'Annulés' },
];

export function WorkflowDetailPage() {
  usePageTitle('Workflow');
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const id = workflowId as Id<'workflows'>;

  const workflow = useAuthQuery(api.features.workflows.queries.getWorkflow, { workflowId: id });
  const setWorkflowStatus = useAuthMutation(api.features.workflows.mutations.setWorkflowStatus);
  const deleteWorkflow = useAuthMutation(api.features.workflows.mutations.deleteWorkflow);
  const cancelRun = useAuthMutation(api.features.workflows.mutations.cancelRun);

  const [runFilter, setRunFilter] = useState<'all' | WorkflowRunStatus>('all');
  const [selectedRunId, setSelectedRunId] = useState<Id<'workflowRuns'> | null>(null);

  const runsArgs = useMemo(
    () => ({ workflowId: id, status: runFilter === 'all' ? undefined : runFilter }),
    [id, runFilter],
  );
  const {
    results: runs,
    status: runsStatus,
    loadMore,
  } = useAuthPaginatedQuery(api.features.workflows.queries.listRuns, runsArgs, {
    initialNumItems: 25,
  });

  if (workflow === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }
  if (workflow === null) {
    return <div className="px-7 py-10 text-faint">Workflow introuvable.</div>;
  }

  const toggleStatus = async () => {
    const next = workflow.status === 'active' ? 'paused' : 'active';
    try {
      await setWorkflowStatus({ workflowId: id, status: next });
      toast.success(next === 'active' ? 'Workflow activé.' : 'Workflow mis en pause.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec du changement de statut.');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Supprimer ce workflow ? Les parcours en cours seront annulés.')) return;
    try {
      await deleteWorkflow({ workflowId: id });
      toast.success('Workflow supprimé.');
      navigate('/workflows');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec de la suppression.');
    }
  };

  const failedCount = Math.max(
    0,
    workflow.enrolledCount - workflow.activeCount - workflow.completedCount,
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title={workflow.name}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <StatusBadge tone={WORKFLOW_STATUS_TONE[workflow.status]}>
              {WORKFLOW_STATUS_LABEL[workflow.status]}
            </StatusBadge>
            <span className="inline-flex items-center gap-1 text-[12.5px] text-faint">
              <Zap className="size-3.5" />
              {triggerLabel(workflow.trigger)}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {workflow.status !== 'active' ? (
              <Button variant="outline" onClick={handleDelete} data-testid="delete-workflow">
                <Trash2 className="size-4" />
                Supprimer
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => navigate(`/workflows/${id}/edit`)}>
              <Pencil className="size-4" />
              Modifier
            </Button>
            <Button onClick={toggleStatus} data-testid="toggle-workflow-status">
              {workflow.status === 'active' ? (
                <>
                  <Pause className="size-4" />
                  Mettre en pause
                </>
              ) : (
                <>
                  <Play className="size-4" />
                  Activer
                </>
              )}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-5 px-5 pb-8 sm:px-7">
        {workflow.bulkReenroll?.status === 'running' && (
          <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-2 text-xs text-info">
            Réinscription en masse en cours — {numberFormat.format(workflow.bulkReenroll.enrolled)}{' '}
            lead(s) réinscrit(s), {numberFormat.format(workflow.bulkReenroll.cancelled)} parcours
            annulé(s)
            {workflow.bulkReenroll.skipped > 0
              ? `, ${numberFormat.format(workflow.bulkReenroll.skipped)} ignoré(s) (plafond quotidien)`
              : ''}
            .
          </p>
        )}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Inscriptions"
            value={numberFormat.format(workflow.enrolledCount)}
            icon={<Users />}
            iconBg="var(--primary-soft)"
            iconColor="var(--primary-strong)"
          />
          <StatCard
            label="En cours"
            value={numberFormat.format(workflow.activeCount)}
            icon={<Play />}
            iconBg="#E8F0FE"
            iconColor="#1A56DB"
          />
          <StatCard
            label="Terminés"
            value={numberFormat.format(workflow.completedCount)}
            icon={<CheckCircle2 />}
            iconBg="#E3F6EC"
            iconColor="#0C8A43"
          />
          <StatCard
            label="Échecs / annulés"
            value={numberFormat.format(failedCount)}
            icon={<XCircle />}
            iconBg="#FDECEC"
            iconColor="#C81E1E"
          />
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-card">
          <KeyValueList>
            <KeyValueRow label="Déclencheur">{triggerLabel(workflow.trigger)}</KeyValueRow>
            <KeyValueRow label="Critères d'inscription">
              {countActiveRules(workflow.enrollmentCriteria) > 0
                ? `${countActiveRules(workflow.enrollmentCriteria)} règle(s) active(s)`
                : 'Aucun'}
            </KeyValueRow>
            <KeyValueRow label="Réinscription">
              {workflow.allowReEnrollment ? 'Autorisée' : 'Une seule fois'}
            </KeyValueRow>
            <KeyValueRow label="Étapes" mono>
              {workflow.nodes.length}
            </KeyValueRow>
          </KeyValueList>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">Parcours</h2>
            <SegmentedControl
              aria-label="Filtrer les parcours"
              items={RUN_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
              value={runFilter}
              onChange={(v) => setRunFilter(v as 'all' | WorkflowRunStatus)}
            />
          </div>

          <div className="rounded-xl border bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Lead</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Déclencheur</TableHead>
                  <TableHead>Inscrit le</TableHead>
                  <TableHead className="pr-4">Terminé le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runsStatus === 'LoadingFirstPage' ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-8 text-center">
                      <Spinner />
                    </TableCell>
                  </TableRow>
                ) : runs.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-8 text-center text-[13px] text-faint">
                      Aucun parcours pour le moment.
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => (
                    <TableRow
                      key={run._id}
                      className="cursor-pointer"
                      data-testid="workflow-run-row"
                      onClick={() => setSelectedRunId(run._id)}
                    >
                      <TableCell className="pl-4 font-medium text-ink">
                        {run.lead ? `${run.lead.firstName} ${run.lead.lastName}` : 'Lead supprimé'}
                        {run.lead?.email ? (
                          <span className="ml-2 text-[12px] text-faint">{run.lead.email}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={RUN_STATUS_TONE[run.status]}>
                          {RUN_STATUS_LABEL[run.status]}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-[13px] text-body">
                        {TRIGGER_TYPE_LABEL[run.triggerType as keyof typeof TRIGGER_TYPE_LABEL] ??
                          run.triggerType}
                      </TableCell>
                      <TableCell className="text-[13px] text-body">
                        {dateTimeFormat.format(new Date(run.enrolledAt))}
                      </TableCell>
                      <TableCell className="pr-4 text-[13px] text-body">
                        {run.finishedAt ? dateTimeFormat.format(new Date(run.finishedAt)) : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {runsStatus === 'CanLoadMore' ? (
              <div className="border-t p-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => loadMore(25)}>
                  Charger plus
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <RunDetailSheet
        runId={selectedRunId}
        onClose={() => setSelectedRunId(null)}
        onCancelRun={async (runId) => {
          try {
            await cancelRun({ runId });
            toast.success('Parcours annulé.');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Échec de l'annulation.");
          }
        }}
      />
    </div>
  );
}
