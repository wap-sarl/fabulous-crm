import {
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { WorkflowNode } from '@crm/lib/backend';
import { CURRENCIES } from '../../../../lib/constants';
import { PipelineStageFields } from './PipelineStageFields';

type CreateDealNode = Extract<WorkflowNode, { type: 'create_deal' }>;

export function CreateDealStepConfig({
  value,
  onChange,
}: {
  value: CreateDealNode;
  onChange: (next: CreateDealNode) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="wf-deal-title">Intitulé de la transaction</Label>
        <Input
          id="wf-deal-title"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="Transaction {{ params.firstName }} {{ params.lastName }}"
        />
        <HelperText>Les {'{{ params.x }}'} du lead sont remplacés à la création.</HelperText>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="wf-deal-amount">Montant (optionnel)</Label>
          <Input
            id="wf-deal-amount"
            type="number"
            min={0}
            value={value.amount !== undefined ? String(value.amount) : ''}
            onChange={(e) =>
              onChange({
                ...value,
                amount: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </div>
        <Select
          value={value.currency ?? 'EUR'}
          onValueChange={(currency) => onChange({ ...value, currency })}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <PipelineStageFields
        pipelineId={value.pipelineId}
        stageKey={value.stageKey}
        onChange={(next) => onChange({ ...value, ...next })}
        pipelineHelper="La transaction est créée pour le lead, son entreprise et son responsable."
        stageRequired={false}
      />
    </div>
  );
}
