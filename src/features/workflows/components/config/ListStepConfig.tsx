import {
  HelperText,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { Id, WorkflowNode } from '@crm/lib/backend';
import { useLeadLists } from '../../../leads/hooks/useLeadLists';

type ListNode = Extract<WorkflowNode, { type: 'add_to_list' | 'remove_from_list' }>;

interface ListStepConfigProps {
  value: ListNode;
  onChange: (next: ListNode) => void;
}

export function ListStepConfig({ value, onChange }: ListStepConfigProps) {
  const lists = useLeadLists().filter((l) => l.kind !== 'dynamic');
  return (
    <div className="space-y-1.5">
      <Label>Liste</Label>
      <Select
        value={(value.listId as string | undefined) ?? undefined}
        onValueChange={(v) => onChange({ ...value, listId: v as Id<'leadLists'> })}
      >
        <SelectTrigger className="w-full" data-testid="list-step-select">
          <SelectValue placeholder="Choisir une liste…" />
        </SelectTrigger>
        <SelectContent>
          {lists.map((l) => (
            <SelectItem key={l._id} value={l._id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {lists.length === 0 ? (
        <HelperText>Aucune liste — créez-en une dans Paramètres → Listes.</HelperText>
      ) : null}
    </div>
  );
}
