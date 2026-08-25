import { useEffect, useState } from 'react';
import { api } from '@crm/lib/backend';
import type { Doc, Id, PipelineStage } from '@crm/lib/backend';
import {
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  validatePipelineStages,
} from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import {
  Button,
  Card,
  IconButton,
  Input,
  Label,
  PageHeader,
  SortableList,
  Spinner,
  StatusBadge,
  Switch,
  toast,
} from '@crm/design-system';
import { Plus, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { formatMoney } from '../../lib/constants';
import { useDealActions } from '../../features/deals/hooks/useDealActions';
import { usePipelines } from '../../features/deals/hooks/usePipelines';
import { DEAL_ERROR_MESSAGES, dealErrorMessage } from '../../features/deals/lib/errors';

function keyFromLabel(label: string, taken: Set<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'stade';
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

function PipelineEditor({
  pipeline,
  onDeleted,
}: {
  pipeline: Doc<'pipelines'>;
  onDeleted: () => void;
}) {
  const { updatePipeline, deletePipeline } = useDealActions();
  const stats = useAuthQuery(api.features.deals.queries.getPipelineStats, {
    pipelineId: pipeline._id,
  });
  const [name, setName] = useState(pipeline.name);
  const [stages, setStages] = useState<PipelineStage[]>(pipeline.stages);
  const [newLabel, setNewLabel] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const countOf = (key: string) => stats?.stages.find((s) => s.key === key)?.count ?? 0;
  const openCount = stages.filter((s) => s.kind === 'open').length;

  useEffect(() => {
    if (dirty) return;
    setName(pipeline.name);
    setStages(pipeline.stages);
  }, [pipeline, dirty]);

  const touch = (next: PipelineStage[]) => {
    setStages(next);
    setDirty(true);
  };
  const patch = (index: number, p: Partial<PipelineStage>) =>
    touch(stages.map((s, i) => (i === index ? { ...s, ...p } : s)));
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    if (stages.length >= MAX_PIPELINE_STAGES) {
      toast.error(DEAL_ERROR_MESSAGES.pipeline_too_many_stages);
      return;
    }
    const key = keyFromLabel(label, new Set(stages.map((s) => s.key)));
    // New stages go before the closed ones so the funnel stays readable.
    const firstClosed = stages.findIndex((s) => s.kind !== 'open');
    const next = [...stages];
    next.splice(firstClosed === -1 ? next.length : firstClosed, 0, {
      key,
      label,
      kind: 'open',
    });
    touch(next);
    setNewLabel('');
  };
  const save = async () => {
    const error = validatePipelineStages(stages);
    if (error) {
      toast.error(DEAL_ERROR_MESSAGES[error] ?? error);
      return;
    }
    setSaving(true);
    try {
      await updatePipeline({ pipelineId: pipeline._id, name, stages });
      setDirty(false);
      toast.success('Pipeline enregistré.');
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Échec de l’enregistrement.'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Supprimer le pipeline « ${pipeline.name} » ?`)) return;
    try {
      await deletePipeline({ pipelineId: pipeline._id });
      toast.success('Pipeline supprimé.');
      onDeleted();
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Échec de la suppression.'));
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="pipeline-editor">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`pipeline-name-${pipeline._id}`}>Nom du pipeline</Label>
          <Input
            id={`pipeline-name-${pipeline._id}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
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
        <Button onClick={save} loading={saving} disabled={!dirty}>
          Enregistrer
        </Button>
        <IconButton variant="secondary" aria-label="Supprimer le pipeline" onClick={remove}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>

      {stats ? (
        <p className="text-xs text-faint">
          {stats.open.count} transaction(s) en cours ({formatMoney(stats.open.amount, 'EUR')}) ·{' '}
          {stats.won.count} gagnée(s) · {stats.lost.count} perdue(s)
        </p>
      ) : null}

      <SortableList
        items={stages}
        getId={(stage) => stage.key}
        onReorder={touch}
        isLocked={(stage) => stage.kind !== 'open'}
        itemClassName="flex flex-wrap items-center gap-2"
        renderItem={(stage, index, handle) => (
          <>
            {handle}
            <span className="w-6 text-right font-mono text-xs text-faint">{index + 1}</span>
            <Input
              value={stage.label}
              onChange={(e) => patch(index, { label: e.target.value })}
              aria-label={`Libellé du stade ${index + 1}`}
              className="min-w-40 flex-1"
              data-testid="pipeline-stage"
            />
            {stage.kind !== 'open' ? (
              <StatusBadge tone={stage.kind === 'won' ? 'green' : 'red'}>
                {stage.kind === 'won' ? 'Gagnée' : 'Perdue'}
              </StatusBadge>
            ) : null}
            <span
              className="w-10 text-right font-mono text-xs text-faint"
              title="Transactions dans ce stade"
            >
              {countOf(stage.key)}
            </span>
            <IconButton
              variant="secondary"
              size="sm"
              aria-label={`Supprimer le stade ${stage.label}`}
              disabled={stage.kind !== 'open' || openCount <= 1 || countOf(stage.key) > 0}
              onClick={() => touch(stages.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </>
        )}
      />
      <div className="flex items-center gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Nouveau stade…"
          aria-label="Libellé du nouveau stade"
          className="flex-1"
        />
        <Button variant="outline" onClick={add} disabled={!newLabel.trim()}>
          <Plus className="size-4" />
          Ajouter
        </Button>
      </div>
    </Card>
  );
}

export function PipelinesPage() {
  usePageTitle('Pipelines');
  const { pipelines, isLoading } = usePipelines();
  const { createPipeline } = useDealActions();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    const name = window.prompt('Nom du nouveau pipeline');
    if (!name?.trim()) return;
    setCreating(true);
    try {
      await createPipeline({ name, stages: [...DEFAULT_PIPELINE_STAGES] });
      toast.success('Pipeline créé.');
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Échec de la création.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Pipelines"
        subtitle="Stades des transactions (les stades gagnée / perdue terminent chaque pipeline) et pipeline par défaut"
        actions={
          <Button onClick={create} loading={creating} data-testid="new-pipeline">
            <Plus className="size-4" />
            Nouveau pipeline
          </Button>
        }
      />
      <div className="mt-6 flex flex-col gap-5">
        {isLoading ? (
          <Spinner size="sm" />
        ) : (
          pipelines.map((p) => (
            <PipelineEditor
              key={p._id as Id<'pipelines'>}
              pipeline={p}
              onDeleted={() => undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
