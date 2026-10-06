import { useMemo } from 'react';
import type { PropertyDefinitionRow } from '../../properties/types';
import { leadFieldCatalog } from '../lib/leadFilters';

/** The full lead filter catalog; it opens no query: the lists and the companies are loaded by their value controls, when a rule on them is shown. */
export function useLeadFieldCatalog(definitions: PropertyDefinitionRow[]) {
  return useMemo(() => leadFieldCatalog(definitions), [definitions]);
}
