import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Token-bound company mutations (create / update / delete). */
export function useCompanyActions() {
  const createCompany = useAuthMutation(api.features.companies.mutations.createCompany);
  const updateCompany = useAuthMutation(api.features.companies.mutations.updateCompany);
  const deleteCompany = useAuthMutation(api.features.companies.mutations.deleteCompany);
  return { createCompany, updateCompany, deleteCompany };
}
