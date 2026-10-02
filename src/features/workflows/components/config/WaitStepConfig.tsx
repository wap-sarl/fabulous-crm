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
import type { WorkflowNode, WorkflowWaitUnit } from '@crm/lib/backend';
import { WAIT_UNIT_LABEL } from '../../lib/constants';

type WaitNode = Extract<WorkflowNode, { type: 'wait' }>;

interface WaitStepConfigProps {
  value: WaitNode;
  onChange: (next: WaitNode) => void;
}

export function WaitStepConfig({ value, onChange }: WaitStepConfigProps) {
  return (
    <div className="space-y-1.5">
      <Label>Durée d’attente</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          className="w-24"
          value={Number.isFinite(value.amount) ? String(value.amount) : ''}
          onChange={(e) =>
            onChange({ ...value, amount: e.target.value === '' ? 0 : Number(e.target.value) })
          }
        />
        <Select
          value={value.unit}
          onValueChange={(unit) => onChange({ ...value, unit: unit as WorkflowWaitUnit })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(WAIT_UNIT_LABEL) as WorkflowWaitUnit[]).map((unit) => (
              <SelectItem key={unit} value={unit}>
                {WAIT_UNIT_LABEL[unit].plural.charAt(0).toUpperCase() +
                  WAIT_UNIT_LABEL[unit].plural.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <HelperText>Le workflow marque une pause avant l’étape suivante (max 90 jours).</HelperText>
    </div>
  );
}
