import { useMemo, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { Combobox } from '@crm/design-system';

interface CompanyPickerProps {
  value: Id<'companies'> | '';
  onChange: (value: Id<'companies'> | '') => void;
  /** Name of the currently selected company (kept visible while the search changes). */
  selectedName?: string | null;
  placeholder?: string;
  disabled?: boolean;
  modal?: boolean;
}

/**
 * Searchable company selector backed by `searchCompanies` (search index, 10
 * rows). The empty item detaches; the lead form then proposes the company
 * matching the email's domain, if any, before saving.
 */
export function CompanyPicker({
  value,
  onChange,
  selectedName,
  placeholder = 'Aucune entreprise',
  disabled,
  modal,
}: CompanyPickerProps) {
  const [search, setSearch] = useState('');
  const results = useAuthQuery(api.features.companies.queries.searchCompanies, {
    search: search || undefined,
  });

  const items = useMemo(() => {
    const rows = results ?? [];
    const list = rows.map((c) => ({ value: c._id as string, label: c.name }));
    // Keep the current selection listed even when it doesn't match the search.
    if (value && !rows.some((c) => c._id === value)) {
      list.unshift({ value, label: selectedName ?? 'Entreprise sélectionnée' });
    }
    return [{ value: '', label: placeholder }, ...list];
  }, [results, value, selectedName, placeholder]);

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(v) => onChange(v as Id<'companies'> | '')}
      onSearch={setSearch}
      placeholder={placeholder}
      searchPlaceholder="Rechercher une entreprise…"
      emptyText="Aucune entreprise trouvée."
      isLoading={results === undefined}
      disabled={disabled}
      modal={modal}
      className="w-full"
    />
  );
}
