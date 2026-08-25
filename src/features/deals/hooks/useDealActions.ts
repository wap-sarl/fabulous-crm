import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Token-bound deal and pipeline mutations. */
export function useDealActions() {
  const createDeal = useAuthMutation(api.features.deals.mutations.createDeal);
  const updateDeal = useAuthMutation(api.features.deals.mutations.updateDeal);
  const moveDealStage = useAuthMutation(api.features.deals.mutations.moveDealStage);
  const deleteDeal = useAuthMutation(api.features.deals.mutations.deleteDeal);
  const createPipeline = useAuthMutation(api.features.deals.mutations.createPipeline);
  const updatePipeline = useAuthMutation(api.features.deals.mutations.updatePipeline);
  const deletePipeline = useAuthMutation(api.features.deals.mutations.deletePipeline);
  return {
    createDeal,
    updateDeal,
    moveDealStage,
    deleteDeal,
    createPipeline,
    updatePipeline,
    deletePipeline,
  };
}
