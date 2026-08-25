import { useMemo, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { Combobox } from '@crm/design-system';

interface LeadPickerProps {
  value: Id<'leads'> | '';
  onChange: (value: Id<'leads'> | '') => void;
  selectedName?: string | null;
  disabled?: boolean;
  modal?: boolean;
}

/** Searchable lead selector (search index, 10 rows). */
export function LeadPicker({ value, onChange, selectedName, disabled, modal }: LeadPickerProps) {
  const [search, setSearch] = useState('');
  const results = useAuthQuery(api.features.crm.queries.searchLeads, {
    search: search || undefined,
  });
  const items = useMemo(() => {
    const rows = results ?? [];
    const list = rows.map((l) => ({
      value: l._id as string,
      label: l.email ? `${l.name} — ${l.email}` : l.name,
    }));
    if (value && !rows.some((l) => l._id === value)) {
      list.unshift({ value, label: selectedName ?? 'Lead sélectionné' });
    }
    return [{ value: '', label: 'Aucun lead' }, ...list];
  }, [results, value, selectedName]);
  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(v) => onChange(v as Id<'leads'> | '')}
      onSearch={setSearch}
      placeholder="Aucun lead"
      searchPlaceholder="Rechercher un lead…"
      emptyText="Aucun lead trouvé."
      isLoading={results === undefined}
      disabled={disabled}
      modal={modal}
      className="w-full"
    />
  );
}
