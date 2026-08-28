import { useEffect, useState } from 'react';
import { api } from '@crm/lib/backend';
import type {
  Doc,
  Id,
  PipelineLayout,
  PipelineStage,
  PipelineStageTag,
  PipelineTransition,
} from '@crm/lib/backend';
import {
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  MAX_STAGE_TAGS,
  fullTransitions,
  isFullTransitions,
  pruneTransitions,
  validatePipelineStages,
  validatePipelineTransitions,
} from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  IconButton,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SortableList,
  Spinner,
  StatusBadge,
  Switch,
  toast,
} from '@crm/design-system';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { formatMoney } from '../../lib/constants';
import { useDealActions } from '../../features/deals/hooks/useDealActions';
import { usePipelines } from '../../features/deals/hooks/usePipelines';
import { PipelineGraphEditor } from '../../features/deals/components/PipelineGraphEditor';
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

type StageStats = { key: string; count: number }[];

/** Full-screen editor: pipeline info and stages on the left, the transition graph on the right. */
function PipelineEditDialog({
  pipeline,
  stageStats,
  open,
  onOpenChange,
}: {
  pipeline: Doc<'pipelines'>;
  stageStats: StageStats;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { updatePipeline } = useDealActions();
  const [name, setName] = useState(pipeline.name);
  const [stages, setStages] = useState<PipelineStage[]>(pipeline.stages);
  const [transitions, setTransitions] = useState<PipelineTransition[] | undefined>(
    pipeline.transitions,
  );
  const [layout, setLayout] = useState<PipelineLayout | undefined>(pipeline.layout);
  const [newLabel, setNewLabel] = useState('');
  const [tagStageKey, setTagStageKey] = useState('');
  const [newTagLabel, setNewTagLabel] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const countOf = (key: string) => stageStats.find((s) => s.key === key)?.count ?? 0;
  const openCount = stages.filter((s) => s.kind === 'open').length;

  useEffect(() => {
    if (!open) return;
    setName(pipeline.name);
    setStages(pipeline.stages);
    setTransitions(pipeline.transitions);
    setLayout(pipeline.layout);
    setNewLabel('');
    setTagStageKey(pipeline.stages.find((s) => s.kind === 'lost')?.key ?? '');
    setNewTagLabel('');
    setDirty(false);
  }, [open, pipeline]);
  const tagStage = stages.find((s) => s.key === tagStageKey) ?? stages[stages.length - 1];
  const tagsOf = (stage: PipelineStage | undefined) => stage?.tags ?? [];
  const setTags = (tags: PipelineStageTag[]) => {
    if (!tagStage) return;
    // The first tag makes them required by default; no tags, no requirement.
    const tagsRequired =
      tags.length === 0 ? undefined : tagStage.tags?.length ? tagStage.tagsRequired : true;
    touch(
      stages.map((s) =>
        s.key === tagStage.key ? { ...s, tags: tags.length ? tags : undefined, tagsRequired } : s,
      ),
    );
  };
  const setTagsRequired = (required: boolean) => {
    if (!tagStage) return;
    touch(stages.map((s) => (s.key === tagStage.key ? { ...s, tagsRequired: required } : s)));
  };
  const addTag = () => {
    const label = newTagLabel.trim();
    if (!label || !tagStage) return;
    const current = tagsOf(tagStage);
    if (current.length >= MAX_STAGE_TAGS) {
      toast.error(DEAL_ERROR_MESSAGES.pipeline_too_many_tags);
      return;
    }
    const key = keyFromLabel(label, new Set(current.map((t) => t.key)));
    setTags([...current, { key, label }]);
    setNewTagLabel('');
  };

  const touch = (next: PipelineStage[]) => {
    setTransitions((prev) =>
      prev === undefined
        ? undefined
        : isFullTransitions(stages, prev)
          ? fullTransitions(next)
          : pruneTransitions(prev, next),
    );
    setStages(next);
    setDirty(true);
  };
  const setGraph = (next: PipelineTransition[] | undefined) => {
    setTransitions(next);
    setDirty(true);
  };
  const setPlacement = (next: PipelineLayout) => {
    setLayout(next);
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
    next.splice(firstClosed === -1 ? next.length : firstClosed, 0, { key, label, kind: 'open' });
    touch(next);
    setNewLabel('');
  };
  const save = async () => {
    const error =
      validatePipelineStages(stages) ?? validatePipelineTransitions(stages, transitions);
    if (error) {
      toast.error(DEAL_ERROR_MESSAGES[error] ?? error);
      return;
    }
    setSaving(true);
    try {
      // null restores the default graph server-side.
      await updatePipeline({
        pipelineId: pipeline._id,
        name,
        stages,
        transitions: transitions ?? null,
        layout: layout ?? null,
      });
      toast.success('Pipeline enregistré.');
      onOpenChange(false);
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Échec de l’enregistrement.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent
        className="left-0 top-0 flex h-screen w-screen max-w-none max-h-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:rounded-none"
        data-testid="pipeline-edit-dialog"
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b px-6 py-4 pr-14">
          <DialogTitle>Modifier le pipeline « {pipeline.name} »</DialogTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={save} loading={saving} disabled={!dirty} data-testid="pipeline-save">
              Enregistrer
            </Button>
          </div>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-3">
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b p-6 lg:border-b-0 lg:border-r">
            <div className="space-y-1.5">
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
            <div className="space-y-2">
              <Label>Stades</Label>
              <SortableList
                items={stages}
                getId={(stage) => stage.key}
                onReorder={touch}
                isLocked={(stage) => stage.kind !== 'open'}
                itemClassName="flex flex-wrap items-center gap-2"
                renderItem={(stage, index, handle) => (
                  <>
                    {handle}
                    <span className="w-5 text-right font-mono text-xs text-faint">{index + 1}</span>
                    <Input
                      value={stage.label}
                      onChange={(e) => patch(index, { label: e.target.value })}
                      aria-label={`Libellé du stade ${index + 1}`}
                      className="min-w-32 flex-1"
                      data-testid="pipeline-stage"
                    />
                    {stage.kind !== 'open' ? (
                      <StatusBadge tone={stage.kind === 'won' ? 'green' : 'red'}>
                        {stage.kind === 'won' ? 'Gagnée' : 'Perdue'}
                      </StatusBadge>
                    ) : null}
                    <span
                      className="w-8 text-right font-mono text-xs text-faint"
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
              <HelperText>
                Les stades gagnée / perdue terminent le pipeline ; un stade qui contient des
                transactions ne peut pas être supprimé.
              </HelperText>
            </div>
            <div className="space-y-2 border-t pt-4" data-testid="stage-tags-editor">
              <Label>Étiquettes par étape</Label>
              <Select value={tagStage?.key} onValueChange={setTagStageKey}>
                <SelectTrigger data-testid="stage-tags-stage">
                  <SelectValue placeholder="Choisir un stade…" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                      {s.tags?.length ? ` (${s.tags.length})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tagStage ? (
                <>
                  <SortableList
                    items={tagsOf(tagStage)}
                    getId={(tag) => tag.key}
                    onReorder={setTags}
                    itemClassName="flex items-center gap-2"
                    renderItem={(tag, index, handle) => (
                      <>
                        {handle}
                        <Input
                          value={tag.label}
                          onChange={(e) =>
                            setTags(
                              tagsOf(tagStage).map((t, i) =>
                                i === index ? { ...t, label: e.target.value } : t,
                              ),
                            )
                          }
                          aria-label={`Libellé de l’étiquette ${index + 1}`}
                          className="flex-1"
                          data-testid="stage-tag"
                        />
                        <IconButton
                          variant="secondary"
                          size="sm"
                          aria-label={`Supprimer l’étiquette ${tag.label}`}
                          onClick={() => setTags(tagsOf(tagStage).filter((_, i) => i !== index))}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </>
                    )}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={newTagLabel}
                      onChange={(e) => setNewTagLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder={
                        tagStage.kind === 'lost' ? 'Nouveau motif de perte…' : 'Nouvelle étiquette…'
                      }
                      aria-label="Libellé de la nouvelle étiquette"
                      className="flex-1"
                      data-testid="new-stage-tag"
                    />
                    <Button
                      variant="outline"
                      onClick={addTag}
                      disabled={!newTagLabel.trim()}
                      data-testid="add-stage-tag"
                    >
                      <Plus className="size-4" />
                      Ajouter
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={!!tagStage.tagsRequired && tagsOf(tagStage).length > 0}
                      disabled={tagsOf(tagStage).length === 0}
                      onCheckedChange={setTagsRequired}
                      data-testid="stage-tags-required"
                    />
                    Au moins une étiquette obligatoire pour entrer dans ce stade
                  </label>
                  <HelperText>
                    Proposées quand une transaction entre dans ce stade (les motifs de perte sur «
                    Perdue ») ; elles se comptent et se filtrent.
                  </HelperText>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-2 p-6 lg:col-span-2">
            <h3 className="text-[13px] font-bold text-ink">Transitions autorisées</h3>
            <PipelineGraphEditor
              stages={stages}
              transitions={transitions}
              onChange={setGraph}
              layout={layout}
              onLayoutChange={setPlacement}
              fill
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PipelineCard({ pipeline }: { pipeline: Doc<'pipelines'> }) {
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

export function PipelinesPage() {
  usePageTitle('Pipelines');
  const { pipelines, isLoading } = usePipelines();
  const { createPipeline } = useDealActions();
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const create = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('Le nom du pipeline est requis.');
      return;
    }
    setCreating(true);
    try {
      await createPipeline({ name, stages: [...DEFAULT_PIPELINE_STAGES] });
      toast.success('Pipeline créé.');
      setCreateOpen(false);
      setNewName('');
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
        subtitle="Stades des transactions, transitions autorisées entre stades (linéaires par défaut) et pipeline par défaut"
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="new-pipeline">
            <Plus className="size-4" />
            Nouveau pipeline
          </Button>
        }
      />
      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouveau pipeline</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-pipeline-name">Nom</Label>
            <Input
              id="new-pipeline-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void create();
                }
              }}
              placeholder="Pipeline partenaires"
              autoFocus
            />
            <HelperText>
              Le pipeline démarre avec les stades standard et des transitions linéaires, modifiables
              ensuite.
            </HelperText>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Annuler
            </Button>
            <Button onClick={create} loading={creating} data-testid="create-pipeline">
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="mt-6 flex flex-col gap-5">
        {isLoading ? (
          <Spinner size="sm" />
        ) : (
          pipelines.map((p) => <PipelineCard key={p._id as Id<'pipelines'>} pipeline={p} />)
        )}
      </div>
    </div>
  );
}
