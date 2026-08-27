import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Every role (built-in first) with user counts, for pickers and the access matrix. */
export function useRoles() {
  const roles = useAuthQuery(api.features.roles.queries.listRoles, {});
  return {
    roles: roles ?? [],
    isLoading: roles === undefined,
    labelOf: (key: string | undefined) => roles?.find((r) => r.key === key)?.label ?? key ?? '',
  };
}
