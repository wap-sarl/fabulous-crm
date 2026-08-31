import { useMemo } from 'react';
import { useCompanyOptions } from '../../companies/hooks/useCompanyOptions';
import type { PropertyDefinitionRow } from '../../properties/types';
import { leadFieldCatalog } from '../lib/leadFilters';
import { useLeadLists } from './useLeadLists';

/** The full lead filter catalog, with live company and list options loaded. */
export function useLeadFieldCatalog(definitions: PropertyDefinitionRow[]) {
  const companies = useCompanyOptions();
  const lists = useLeadLists();
  return useMemo(
    () => leadFieldCatalog(definitions, { companies, lists }),
    [definitions, companies, lists],
  );
}
