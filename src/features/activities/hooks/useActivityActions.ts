import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Token-bound activity mutations. */
export function useActivityActions() {
  const createActivity = useAuthMutation(api.features.activities.mutations.createActivity);
  const updateActivity = useAuthMutation(api.features.activities.mutations.updateActivity);
  const completeActivity = useAuthMutation(api.features.activities.mutations.completeActivity);
  const reopenActivity = useAuthMutation(api.features.activities.mutations.reopenActivity);
  const cancelActivity = useAuthMutation(api.features.activities.mutations.cancelActivity);
  const deleteActivity = useAuthMutation(api.features.activities.mutations.deleteActivity);
  const logCall = useAuthMutation(api.features.activities.mutations.logCall);
  return {
    createActivity,
    updateActivity,
    completeActivity,
    reopenActivity,
    cancelActivity,
    deleteActivity,
    logCall,
  };
}

export const ACTIVITY_ERROR_MESSAGES: Record<string, string> = {
  activity_title_required: 'L’intitulé est requis.',
  activity_not_found: 'Activité introuvable.',
  activity_link_required: 'Rattachez l’appel à un lead, une entreprise ou une transaction.',
  invalid_owner: 'Propriétaire invalide.',
  lead_not_found: 'Lead introuvable.',
  company_not_found: 'Entreprise introuvable.',
  deal_not_found: 'Transaction introuvable.',
};

export function activityErrorMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : '';
  const known = Object.keys(ACTIVITY_ERROR_MESSAGES).find((k) => message.includes(k));
  return known ? ACTIVITY_ERROR_MESSAGES[known] : fallback;
}
