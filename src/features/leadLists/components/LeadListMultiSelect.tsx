import { MultiSelect } from '@crm/design-system';
import { useLeadLists } from '../../leads/hooks/useLeadLists';

interface LeadListMultiSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  modal?: boolean;
  className?: string;
}

/** The lists to choose from, loaded when the control is shown: a filter that has no rule on the lists opens no query on them. */
export function LeadListMultiSelect({
  value,
  onChange,
  modal,
  className,
}: LeadListMultiSelectProps) {
  const lists = useLeadLists();
  return (
    <MultiSelect
      items={lists.map((list) => ({ value: list._id, label: list.name }))}
      value={value}
      onValueChange={onChange}
      placeholder="Sélectionner…"
      modal={modal}
      className={className}
    />
  );
}
