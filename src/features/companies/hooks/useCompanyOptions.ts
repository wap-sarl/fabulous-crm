import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Live companies as { _id, name } filter options. Returns [] while loading. */
export function useCompanyOptions() {
  return useAuthQuery(api.features.companies.queries.listCompanyOptions, {}) ?? [];
}
