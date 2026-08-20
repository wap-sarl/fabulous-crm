import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Token-bound lead mutations (create / update / delete / import). */
export function useLeadActions() {
  const createLead = useAuthMutation(api.features.crm.mutations.createLead);
  const updateLead = useAuthMutation(api.features.crm.mutations.updateLead);
  const deleteLead = useAuthMutation(api.features.crm.mutations.deleteLead);
  const deleteLeads = useAuthMutation(api.features.crm.mutations.deleteLeads);
  const importLeads = useAuthMutation(api.features.crm.mutations.importLeads);
  const createLeadList = useAuthMutation(api.features.crm.mutations.createLeadList);
  const deleteLeadList = useAuthMutation(api.features.crm.mutations.deleteLeadList);

  return {
    createLead,
    updateLead,
    deleteLead,
    deleteLeads,
    importLeads,
    createLeadList,
    deleteLeadList,
  };
}
