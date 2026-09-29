import { useEffect, useState } from 'react';
import type {
  Doc,
  PipelineLayout,
  PipelineStage,
  PipelineStageTag,
  PipelineTransition,
} from '@crm/lib/backend';
import {
  MAX_PIPELINE_STAGES,
  MAX_STAGE_TAGS,
  fullTransitions,
  isFullTransitions,
  pruneTransitions,
  validatePipelineStages,
  validatePipelineTransitions,
} from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  HelperText,
  IconButton,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SortableList,
  StatusBadge,
  Switch,
  toast,
} from '@crm/design-system';
import { Plus, Trash2 } from 'lucide-react';
import { useDealActions } from '../hooks/useDealActions';
import { PipelineGraphEditor } from './PipelineGraphEditor';
import { DEAL_ERROR_MESSAGES, dealErrorMessage } from '../lib/errors';
import { keyFromLabel } from '@crm/lib/keys';

type StageStats = { key: string; count: number }[];

/** Full-screen editor: pipeline info and stages on the left, the transition graph on the right. */
export function PipelineEditDialog({
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
    const key = keyFromLabel(label, new Set(current.map((t) => t.key)), 'stade');
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
    const key = keyFromLabel(label, new Set(stages.map((s) => s.key)), 'stade');
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
