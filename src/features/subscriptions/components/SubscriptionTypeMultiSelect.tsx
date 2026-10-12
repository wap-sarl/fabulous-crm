import { MultiSelect } from '@crm/design-system';
import type { MarketingConsentChannel } from '@crm/lib/backend';
import { useSubscriptionTypes } from '../hooks/useSubscriptionTypes';

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  /** Only the types of this channel, when the choice is bound to one. */
  channel?: MarketingConsentChannel;
  modal?: boolean;
  className?: string;
}

/** The active types, loaded when the control is shown: the value of a « est inscrit à » rule, the types a form's box grants. */
export function SubscriptionTypeMultiSelect({ value, onChange, channel, modal, className }: Props) {
  const types = useSubscriptionTypes();
  return (
    <MultiSelect
      items={types
        .filter((t) => t.active && (channel === undefined || t.channel === channel))
        .map((t) => ({ value: t._id, label: t.name }))}
      value={value}
      onValueChange={onChange}
      placeholder="Sélectionner…"
      modal={modal}
      className={className}
    />
  );
}
