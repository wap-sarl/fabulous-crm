import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

const NONE: never[] = [];

/** All lead lists with member counts and importer names; the same empty array while loading, or when the caller has nothing to show them in. */
export function useLeadLists(enabled = true) {
  return useAuthQuery(api.features.leadLists.queries.listLeadLists, enabled ? {} : 'skip') ?? NONE;
}
