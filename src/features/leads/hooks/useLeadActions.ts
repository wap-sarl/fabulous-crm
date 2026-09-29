import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Token-bound lead mutations (create / update / delete / import). */
export function useLeadActions() {
  const createLead = useAuthMutation(api.features.leads.mutations.createLead);
  const updateLead = useAuthMutation(api.features.leads.mutations.updateLead);
  const deleteLead = useAuthMutation(api.features.leads.mutations.deleteLead);
  const deleteLeads = useAuthMutation(api.features.leads.mutations.deleteLeads);
  const importLeads = useAuthMutation(api.features.leads.mutations.importLeads);
  const createLeadList = useAuthMutation(api.features.leadLists.mutations.createLeadList);
  const updateLeadList = useAuthMutation(api.features.leadLists.mutations.updateLeadList);
  const recalcLeadList = useAuthMutation(api.features.leadLists.mutations.recalcLeadList);
  const deleteLeadList = useAuthMutation(api.features.leadLists.mutations.deleteLeadList);

  return {
    createLead,
    updateLead,
    deleteLead,
    deleteLeads,
    importLeads,
    createLeadList,
    updateLeadList,
    recalcLeadList,
    deleteLeadList,
  };
}
