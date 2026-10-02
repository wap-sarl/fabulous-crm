import {
  HelperText,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { WorkflowNode } from '@crm/lib/backend';
import { useLifecycleConfig } from '../../../leads/hooks/useLifecycleConfig';

type LifecycleNode = Extract<WorkflowNode, { type: 'set_lifecycle_stage' }>;

interface LifecycleStepConfigProps {
  value: LifecycleNode;
  onChange: (next: LifecycleNode) => void;
}

export function LifecycleStepConfig({ value, onChange }: LifecycleStepConfigProps) {
  const lifecycle = useLifecycleConfig();
  return (
    <div className="space-y-1.5">
      <Label>Statut</Label>
      <Select
        value={value.stage ?? undefined}
        onValueChange={(v) => onChange({ ...value, stage: v })}
      >
        <SelectTrigger className="w-full" data-testid="lifecycle-step-select">
          <SelectValue placeholder="Choisir un statut…" />
        </SelectTrigger>
        <SelectContent>
          {lifecycle.stages.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <HelperText>
        {lifecycle.allowRegression
          ? 'Le lead passe à ce statut, même s’il précède le statut actuel.'
          : 'Le lead passe à ce statut ; un retour en arrière est ignoré (Paramètres → Statuts).'}
      </HelperText>
    </div>
  );
}
