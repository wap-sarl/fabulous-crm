import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Employees, for the lead "assigned to" selector. */
export function useEmployees() {
  const employees = useAuthQuery(api.features.users.queries.listEmployees, {});
  return {
    employees: employees ?? [],
    isLoading: employees === undefined,
  };
}
