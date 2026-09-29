import { useState } from 'react';
import { api } from '@crm/lib/backend';
import type { Doc, PipelineStage } from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import { Button, Card, ConfirmDialog, IconButton, Switch, toast } from '@crm/design-system';
import { Pencil, Trash2 } from 'lucide-react';
import { formatMoney } from '../../../lib/constants';
import { useDealActions } from '../hooks/useDealActions';
import { PipelineGraphEditor } from './PipelineGraphEditor';
import { dealErrorMessage } from '../lib/errors';
import { PipelineEditDialog } from './PipelineEditDialog';

export function PipelineCard({ pipeline }: { pipeline: Doc<'pipelines'> }) {
  const { updatePipeline, deletePipeline } = useDealActions();
  const stats = useAuthQuery(api.features.deals.queries.getPipelineStats, {
    pipelineId: pipeline._id,
  });
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const countOf = (key: string) => stats?.stages.find((s) => s.key === key)?.count ?? 0;
  const total = stats ? stats.open.count + stats.won.count + stats.lost.count : 0;

  const remove = async () => {
    try {
      await deletePipeline({ pipelineId: pipeline._id });
      toast.success('Pipeline supprimé.');
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Échec de la suppression.'));
      setDeleteOpen(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="pipeline-editor">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold text-ink">{pipeline.name}</h2>
          {stats ? (
            <p className="text-xs text-faint">
              {stats.open.count} transaction(s) en cours ({formatMoney(stats.open.amount, 'EUR')}) ·{' '}
              {stats.won.count} gagnée(s) · {stats.lost.count} perdue(s)
            </p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={!!pipeline.isDefault}
            disabled={!!pipeline.isDefault}
            onCheckedChange={async (checked) => {
              if (!checked) return;
              try {
                await updatePipeline({ pipelineId: pipeline._id, isDefault: true });
              } catch (e) {
                toast.error(dealErrorMessage(e, 'Échec.'));
              }
            }}
          />
          Pipeline par défaut
        </label>
        <Button variant="outline" onClick={() => setEditOpen(true)} data-testid="pipeline-edit">
          <Pencil className="size-4" />
          Modifier
        </Button>
        <IconButton
          variant="secondary"
          aria-label="Supprimer le pipeline"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>

      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Stades">
        {pipeline.stages.map((stage, index) => (
          <li key={stage.key} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-faint">→</span> : null}
            <span
              className={cnStage(stage)}
              data-testid="pipeline-stage-chip"
              title={`${countOf(stage.key)} transaction(s)`}
            >
              {stage.label}
              <span className="ml-1.5 font-mono text-[10.5px] opacity-70">
                {countOf(stage.key)}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <PipelineGraphEditor
        stages={pipeline.stages}
        transitions={pipeline.transitions}
        layout={pipeline.layout}
        readOnly
      />

      <PipelineEditDialog
        pipeline={pipeline}
        stageStats={stats?.stages ?? []}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Supprimer le pipeline « ${pipeline.name} » ?`}
        description={
          total > 0
            ? `Ce pipeline contient ${total} transaction(s) : déplacez-les ou supprimez-les d’abord.`
            : 'Ses stades disparaissent ; cette action est irréversible.'
        }
        confirmLabel="Supprimer le pipeline"
        destructive
        onConfirm={remove}
      />
    </Card>
  );
}

function cnStage(stage: PipelineStage): string {
  const base = 'rounded-md px-2 py-1 text-xs font-semibold';
  if (stage.kind === 'won') return `${base} bg-green-100 text-green-700`;
  if (stage.kind === 'lost') return `${base} bg-red-100 text-red-600`;
  return `${base} bg-[#F2F3F5] text-ink`;
}
