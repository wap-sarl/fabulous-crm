import { MultiSelect } from '@crm/design-system';
import { useSubscriptionTypes } from '../hooks/useSubscriptionTypes';

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  modal?: boolean;
  className?: string;
}

/** The value control of a « est inscrit à » rule: the active types, loaded when the rule is shown. */
export function SubscriptionTypeMultiSelect({ value, onChange, modal, className }: Props) {
  const types = useSubscriptionTypes();
  return (
    <MultiSelect
      items={types.filter((t) => t.active).map((t) => ({ value: t._id, label: t.name }))}
      value={value}
      onValueChange={onChange}
      placeholder="Sélectionner…"
      modal={modal}
      className={className}
    />
  );
}
