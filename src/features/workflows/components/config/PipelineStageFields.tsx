import {
  HelperText,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { Id } from '@crm/lib/backend';
import { usePipelines } from '../../../deals/hooks/usePipelines';

const ANY_PIPELINE = '__default__';

/** Pipeline + stage pair used by both deal steps. */
export function PipelineStageFields({
  pipelineId,
  stageKey,
  onChange,
  pipelineHelper,
  stageRequired,
}: {
  pipelineId: Id<'pipelines'> | undefined;
  stageKey: string | undefined;
  onChange: (next: { pipelineId?: Id<'pipelines'>; stageKey?: string }) => void;
  pipelineHelper: string;
  stageRequired: boolean;
}) {
  const { pipelines, byId, defaultPipeline } = usePipelines();
  const pipeline = (pipelineId ? byId.get(pipelineId) : undefined) ?? defaultPipeline;
  return (
    <>
      <div className="space-y-1.5">
        <Label>Pipeline</Label>
        <Select
          value={(pipelineId as string | undefined) ?? ANY_PIPELINE}
          onValueChange={(v) =>
            onChange({
              pipelineId: v === ANY_PIPELINE ? undefined : (v as Id<'pipelines'>),
              stageKey: undefined,
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_PIPELINE}>Pipeline par défaut</SelectItem>
            {pipelines.map((p) => (
              <SelectItem key={p._id} value={p._id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <HelperText>{pipelineHelper}</HelperText>
      </div>
      <div className="space-y-1.5">
        <Label>Stade{stageRequired ? '' : ' (optionnel)'}</Label>
        <Select
          value={stageKey ?? (stageRequired ? undefined : '__first__')}
          onValueChange={(v) =>
            onChange({ pipelineId, stageKey: v === '__first__' ? undefined : v })
          }
        >
          <SelectTrigger className="w-full" data-testid="deal-stage-select">
            <SelectValue placeholder="Choisir un stade…" />
          </SelectTrigger>
          <SelectContent>
            {!stageRequired ? (
              <SelectItem value="__first__">Premier stade ouvert</SelectItem>
            ) : null}
            {(pipeline?.stages ?? []).map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
