import { HelperText, Label, MultiSelect } from '@crm/design-system';
import { stageRequiresTag } from '@crm/lib/backend';
import type { WorkflowNode } from '@crm/lib/backend';
import { usePipelines } from '../../../deals/hooks/usePipelines';
import { PipelineStageFields } from './PipelineStageFields';

type DealStageNode = Extract<WorkflowNode, { type: 'update_deal_stage' }>;

export function DealStageStepConfig({
  value,
  onChange,
}: {
  value: DealStageNode;
  onChange: (next: DealStageNode) => void;
}) {
  const { byId, defaultPipeline } = usePipelines();
  const pipeline = (value.pipelineId ? byId.get(value.pipelineId) : undefined) ?? defaultPipeline;
  const stage = pipeline?.stages.find((s) => s.key === value.stageKey);
  const tags = stage?.tags ?? [];
  const required = stage ? stageRequiresTag(stage) : false;
  return (
    <div className="flex flex-col gap-4">
      <PipelineStageFields
        pipelineId={value.pipelineId}
        stageKey={value.stageKey}
        onChange={(next) => onChange({ ...value, ...next, tags: undefined })}
        pipelineHelper="Déplace la transaction ouverte la plus récente du lead (dans ce pipeline)."
        stageRequired
      />
      {tags.length > 0 ? (
        <div className="space-y-1.5">
          <Label>Étiquettes posées{required ? ' *' : ''}</Label>
          <MultiSelect
            items={tags.map((t) => ({ value: t.key, label: t.label }))}
            value={value.tags ?? []}
            onValueChange={(v) => onChange({ ...value, tags: v.length ? v : undefined })}
            placeholder="Aucune étiquette"
            className="w-full"
          />
          <HelperText>
            {required ? 'Ce stade en exige au moins une ; ' : ''}enregistrées sur la transaction et
            dans son historique à chaque passage.
          </HelperText>
        </div>
      ) : null}
    </div>
  );
}
