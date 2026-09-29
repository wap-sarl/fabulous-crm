import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';

export function useScoringActions() {
  const createScoringRule = useAuthMutation(api.features.scoring.mutations.createScoringRule);
  const updateScoringRule = useAuthMutation(api.features.scoring.mutations.updateScoringRule);
  const deleteScoringRule = useAuthMutation(api.features.scoring.mutations.deleteScoringRule);
  const reorderScoringRules = useAuthMutation(api.features.scoring.mutations.reorderScoringRules);
  const recomputeScores = useAuthMutation(api.features.scoring.mutations.recomputeScores);
  const startScoreSimulation = useAuthMutation(api.features.scoring.mutations.startScoreSimulation);
  return {
    createScoringRule,
    updateScoringRule,
    deleteScoringRule,
    reorderScoringRules,
    recomputeScores,
    startScoreSimulation,
  };
}
