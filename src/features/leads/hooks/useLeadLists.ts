import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/**
 * All lead lists with member counts and importer names. Used by the list filter,
 * the CSV import dialog, and the lists settings page. Returns [] while loading.
 */
export function useLeadLists() {
  return useAuthQuery(api.features.crm.queries.listLeadLists, {}) ?? [];
}
