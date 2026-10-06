import { useMemo } from 'react';
import type { PropertyDefinitionRow } from '../../properties/types';
import { leadFieldCatalog } from '../lib/leadFilters';
import { useLeadLists } from './useLeadLists';

/** The full lead filter catalog, with the live list options loaded; companies are searched by their field as one types. */
export function useLeadFieldCatalog(definitions: PropertyDefinitionRow[]) {
  const lists = useLeadLists();
  return useMemo(() => leadFieldCatalog(definitions, { lists }), [definitions, lists]);
}
