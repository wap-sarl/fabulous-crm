import { useMemo, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { CampaignChannel, Id } from '@crm/lib/backend';
import { Combobox } from '@crm/design-system';

interface CampaignPickerProps {
  value: Id<'campaigns'> | '';
  onChange: (value: Id<'campaigns'> | '') => void;
  /** Only the campaigns of this channel are offered. */
  channel?: CampaignChannel;
  /** The empty choice, as the first item and on the closed trigger. */
  placeholder?: string;
  disabled?: boolean;
  modal?: boolean;
}

/** A campaign chosen by name as one types; the search returns ten rows at most and keeps the chosen one listed. */
export function CampaignPicker({
  value,
  onChange,
  channel,
  placeholder = 'Aucune campagne',
  disabled,
  modal,
}: CampaignPickerProps) {
  const [search, setSearch] = useState('');
  const results = useAuthQuery(api.features.campaigns.queries.searchCampaigns, {
    search: search || undefined,
    channel,
    selected: value || undefined,
  });

  const items = useMemo(
    () => [
      { value: '', label: placeholder },
      ...(results ?? []).map((c) => ({ value: c._id as string, label: c.name })),
    ],
    [results, placeholder],
  );

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(v) => onChange(v as Id<'campaigns'> | '')}
      onSearch={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Rechercher une campagne…"
      emptyText="Aucune campagne trouvée."
      isLoading={results === undefined}
      disabled={disabled}
      modal={modal}
      className="w-full"
    />
  );
}
