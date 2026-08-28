import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthQuery } from '@crm/widgets';
import { api, isTransitionAllowed } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import {
  Button,
  Card,
  ConfirmDialog,
  KeyValueList,
  KeyValueRow,
  PageHeader,
  Spinner,
  StatusBadge,
  cn,
  toast,
} from '@crm/design-system';
import { ArrowRight, Handshake, Pencil, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { DEAL_STATUS_LABEL, DEAL_STATUS_TONE, formatMoney } from '../../lib/constants';
import { DealFormDialog } from '../../features/deals/components/DealFormDialog';
import { EntityActivitiesCard } from '../../features/activities/components/EntityActivitiesCard';
import { EntityAttachmentsCard } from '../../features/attachments/components/EntityAttachmentsCard';
import { useDealActions } from '../../features/deals/hooks/useDealActions';
import { dealErrorMessage } from '../../features/deals/lib/errors';
import { useStageMove } from '../../features/deals/components/StageMoveDialog';
import { CustomPropertyRows } from '../../features/properties/components/CustomPropertyRows';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const SOURCE_LABEL: Record<string, string> = {
  create: 'Création',
  manual: 'Manuel',
  workflow: 'Workflow',
};

export function DealDetailPage() {
  usePageTitle('Transaction');
  const navigate = useNavigate();
  const { dealId } = useParams<{ dealId: string }>();
  const data = useAuthQuery(
    api.features.deals.queries.getDeal,
    dealId ? { dealId: dealId as Id<'deals'> } : 'skip',
  );
  const { deleteDeal } = useDealActions();
  const definitions = usePropertyDefinitions('deal');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { requestMove, dialog: stageMoveDialog } = useStageMove();

  if (data === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }
  if (data === null) return <p className="p-7 text-faint">Transaction introuvable.</p>;
  const { deal, pipeline, history, sourceCampaignName } = data;
  const currentIndex = pipeline?.stages.findIndex((s) => s.key === deal.stageKey) ?? -1;

  const handleDelete = async () => {
    try {
      await deleteDeal({ dealId: deal._id });
      toast.success('Transaction supprimée.');
      navigate(`/deals?pipeline=${deal.pipelineId}`);
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Échec de la suppression.'));
      setDeleteOpen(false);
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        onBack={() => navigate(`/deals?pipeline=${deal.pipelineId}`)}
        leading={
          <span className="flex size-[46px] items-center justify-center rounded-xl bg-[#E3F6EC] text-[#0C8A43]">
            <Handshake className="size-5" />
          </span>
        }
        title={deal.title}
        titleExtra={
          <StatusBadge tone={DEAL_STATUS_TONE[deal.status]}>{deal.stageLabel}</StatusBadge>
        }
        subtitle={[formatMoney(deal.amount, deal.currency), pipeline?.name]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Modifier
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(true)}
              aria-label="Supprimer la transaction"
              data-testid="delete-deal"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-5 px-5 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-5">
          {pipeline ? (
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-bold text-ink">Stade</h2>
              <ol
                className="flex flex-wrap gap-1.5"
                aria-label="Stades du pipeline"
                data-testid="deal-stages"
              >
                {pipeline.stages.map((stage, index) => {
                  const current = stage.key === deal.stageKey;
                  const reached = index <= currentIndex && deal.status === 'open';
                  const allowed =
                    current || isTransitionAllowed(pipeline, deal.stageKey, stage.key);
                  return (
                    <li key={stage.key}>
                      <button
                        type="button"
                        onClick={() => requestMove(deal, stage)}
                        disabled={!allowed}
                        title={
                          allowed ? undefined : 'Transition non autorisée depuis le stade actuel'
                        }
                        aria-current={current ? 'step' : undefined}
                        data-testid={`deal-stage-${stage.key}`}
                        className={cn(
                          'cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                          !allowed && 'cursor-not-allowed opacity-40',
                          current
                            ? stage.kind === 'won'
                              ? 'bg-green-600 text-white'
                              : stage.kind === 'lost'
                                ? 'bg-red-500 text-white'
                                : 'bg-primary text-white'
                            : reached
                              ? 'bg-primary/10 text-primary hover:bg-primary/20'
                              : 'bg-[#F2F3F5] text-soft hover:bg-[#E6E8EC]',
                        )}
                      >
                        {stage.label}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-faint">
                Cliquez sur un stade pour y déplacer la transaction (les stades grisés ne sont pas
                atteignables depuis le stade actuel).
              </p>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-2 text-[15px] font-bold text-ink">Détails</h2>
            <KeyValueList>
              <KeyValueRow label="Statut">{DEAL_STATUS_LABEL[deal.status]}</KeyValueRow>
              <KeyValueRow label="Montant" mono>
                {formatMoney(deal.amount, deal.currency)}
              </KeyValueRow>
              <KeyValueRow label="Clôture prévue" mono>
                {deal.expectedCloseDate ? dateFormat.format(new Date(deal.expectedCloseDate)) : '—'}
              </KeyValueRow>
              <KeyValueRow label="Clôturée le" mono>
                {deal.closedAt ? dateTimeFormat.format(deal.closedAt) : '—'}
              </KeyValueRow>
              <KeyValueRow label="Propriétaires">{deal.ownerNames.join(', ') || '—'}</KeyValueRow>
              <KeyValueRow label="Lead">
                {deal.leadId ? (
                  <Link to={`/leads/${deal.leadId}`} className="text-primary hover:underline">
                    {deal.leadName ?? 'Lead'}
                  </Link>
                ) : (
                  '—'
                )}
              </KeyValueRow>
              <KeyValueRow label="Campagne d’origine">
                {deal.sourceCampaignId ? (
                  <Link
                    to={`/campaigns/${deal.sourceCampaignId}`}
                    className="text-primary hover:underline"
                  >
                    {sourceCampaignName ?? 'Campagne'}
                  </Link>
                ) : (
                  '—'
                )}
              </KeyValueRow>
              <CustomPropertyRows definitions={definitions} values={deal.customProperties} />
              <KeyValueRow label="Créée le" mono>
                {dateFormat.format(deal._creationTime)}
              </KeyValueRow>
            </KeyValueList>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <EntityActivitiesCard dealId={deal._id} />

          <EntityAttachmentsCard entityType="deal" entityId={deal._id} />

          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-bold text-ink">Historique des stades</h2>
            {history.length === 0 ? (
              <p className="text-sm text-faint">Aucun historique.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border" data-testid="deal-history">
                {[...history].reverse().map((row) => (
                  <li key={row._id} className="flex flex-col gap-0.5 py-2 text-sm">
                    <span className="flex items-center gap-1.5 font-medium text-ink">
                      {row.fromLabel ? (
                        <>
                          <span className="text-faint">{row.fromLabel}</span>
                          <ArrowRight className="size-3.5 text-faint" aria-hidden />
                        </>
                      ) : null}
                      <span>{row.toLabel}</span>
                    </span>
                    <span className="text-xs text-faint">
                      {dateTimeFormat.format(row.changedAt)} ·{' '}
                      {row.source === 'workflow'
                        ? (row.workflowName ?? 'Workflow')
                        : (row.changedByName ?? SOURCE_LABEL[row.source])}
                    </span>
                    {row.tags.length > 0 || row.comment ? (
                      <span className="flex flex-wrap items-center gap-1 text-xs">
                        {row.tags.map((label) => (
                          <StatusBadge key={label} tone="gray">
                            {label}
                          </StatusBadge>
                        ))}
                        {row.comment ? <span className="text-soft">{row.comment}</span> : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <DealFormDialog open={editOpen} onOpenChange={setEditOpen} deal={deal} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Supprimer « ${deal.title} » ?`}
        description={`La transaction${
          deal.amount !== undefined ? ` de ${formatMoney(deal.amount, deal.currency)}` : ''
        } et son historique de stades seront supprimés. Cette action est irréversible.`}
        confirmLabel="Supprimer la transaction"
        destructive
        onConfirm={handleDelete}
      />
      {stageMoveDialog}
    </div>
  );
}
