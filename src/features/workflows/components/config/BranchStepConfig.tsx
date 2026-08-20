import { HelperText, Label } from '@crm/design-system';
import type { WorkflowNode } from '@crm/lib/backend';
import { AdvancedFilterGroupsEditor } from '../../../leads/components/AdvancedFilterBuilder';
import type { LeadPropertyDefinitionRow } from '../../../leads/types';

type BranchNode = Extract<WorkflowNode, { type: 'branch' }>;

interface BranchStepConfigProps {
  value: BranchNode;
  onChange: (next: BranchNode) => void;
  definitions: LeadPropertyDefinitionRow[];
}

/** If/else condition — the same AND/OR groups editor as the lead filters. */
export function BranchStepConfig({ value, onChange, definitions }: BranchStepConfigProps) {
  return (
    <div className="space-y-2">
      <Label>Condition</Label>
      <HelperText>
        Évaluée sur le lead au moment où il atteint cette étape : s’il correspond, il suit la
        branche <span className="font-semibold text-green-700">Oui</span>, sinon la branche{' '}
        <span className="font-semibold text-red-600">Non</span>.
      </HelperText>
      <div className="space-y-3">
        <AdvancedFilterGroupsEditor
          value={value.condition}
          onChange={(condition) => onChange({ ...value, condition })}
          definitions={definitions}
        />
      </div>
    </div>
  );
}
