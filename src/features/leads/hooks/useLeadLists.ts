import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** All lead lists with member counts and importer names; an empty array while loading. */
export function useLeadLists() {
  return useAuthQuery(api.features.crm.queries.listLeadLists, {}) ?? [];
}
