import { errorLabel } from '@crm/lib/errors';
import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Duplicate detection mutations: scan, ignore a pair, merge two leads. */
export function useDuplicateActions() {
  const startDuplicateScan = useAuthMutation(api.features.duplicates.mutations.startDuplicateScan);
  const ignoreDuplicatePair = useAuthMutation(
    api.features.duplicates.mutations.ignoreDuplicatePair,
  );
  const mergeLeads = useAuthMutation(api.features.duplicates.mutations.mergeLeads);
  return { startDuplicateScan, ignoreDuplicatePair, mergeLeads };
}

const ERROR_MESSAGES: Record<string, string> = {
  scan_running: 'Une analyse est déjà en cours.',
  lead_not_found: 'Un des deux leads n’existe plus.',
  merge_same_lead: 'Choisissez deux leads différents.',
  unknown_lifecycle_stage: 'Statut inconnu.',
  invalid_assignee: 'Collaborateur introuvable.',
  company_not_found: 'Entreprise introuvable.',
};

export const duplicateErrorMessage = (e: unknown, fallback: string) =>
  errorLabel(e, ERROR_MESSAGES, fallback);
