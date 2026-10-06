import { useMemo, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { MultiSelect } from '@crm/design-system';

interface CompanyMultiPickerProps {
  value: Id<'companies'>[];
  onChange: (value: Id<'companies'>[]) => void;
  modal?: boolean;
  className?: string;
}

/** Companies chosen by name as one types; the search returns ten rows at most, the chosen ones are named by their ids whatever the search shows. */
export function CompanyMultiPicker({ value, onChange, modal, className }: CompanyMultiPickerProps) {
  const [search, setSearch] = useState('');
  const results = useAuthQuery(api.features.companies.queries.searchCompanies, {
    search: search || undefined,
  });
  const chosen = useAuthQuery(api.features.companies.queries.listCompanyOptions, { ids: value });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const items = [];
    for (const c of [...(chosen ?? []), ...(results ?? [])]) {
      if (seen.has(c._id)) continue;
      seen.add(c._id);
      items.push({ value: c._id as string, label: c.name });
    }
    return items;
  }, [chosen, results]);

  return (
    <MultiSelect
      items={items}
      value={value}
      onValueChange={(v) => onChange(v as Id<'companies'>[])}
      onSearch={setSearch}
      placeholder="Sélectionner…"
      searchPlaceholder="Rechercher une entreprise…"
      emptyText="Aucune entreprise trouvée."
      isLoading={results === undefined}
      modal={modal}
      className={className}
    />
  );
}
