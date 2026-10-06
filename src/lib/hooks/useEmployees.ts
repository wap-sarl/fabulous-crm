import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

const NONE: never[] = [];

/** Employees, for the "assigned to" selectors; a dialog passes whether it is open, so that a closed one opens no query, and is not said to be loading. */
export function useEmployees(enabled = true) {
  const employees = useAuthQuery(api.features.users.queries.listEmployees, enabled ? {} : 'skip');
  return {
    employees: employees ?? NONE,
    isLoading: enabled && employees === undefined,
  };
}
