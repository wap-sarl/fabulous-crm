import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Token-bound company mutations (create / update / delete). */
export function useCompanyActions() {
  const createCompany = useAuthMutation(api.features.companies.mutations.createCompany);
  const updateCompany = useAuthMutation(api.features.companies.mutations.updateCompany);
  const deleteCompany = useAuthMutation(api.features.companies.mutations.deleteCompany);
  return { createCompany, updateCompany, deleteCompany };
}

/** French messages for the company mutations' error codes. */
export const COMPANY_ERROR_MESSAGES: Record<string, string> = {
  company_name_required: 'Le nom de l’entreprise est requis.',
  company_registration_exists: 'Une entreprise porte déjà ce numéro d’immatriculation.',
  company_domain_exists: 'Une entreprise porte déjà ce domaine.',
  invalid_registration_number: 'Numéro d’immatriculation invalide.',
  company_vat_exists: 'Une entreprise porte déjà ce numéro de TVA.',
  invalid_vat_number: 'Numéro de TVA invalide.',
  invalid_address: 'Adresse invalide.',
  invalid_domain: 'Domaine invalide (ex. acme.fr).',
  invalid_country: 'Pays invalide.',
  company_not_found: 'Entreprise introuvable.',
  lifecycle_regression_blocked:
    'Le retour à une étape antérieure du cycle de vie est désactivé (Paramètres → Cycle de vie).',
};

export function companyErrorMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : '';
  const known = Object.keys(COMPANY_ERROR_MESSAGES).find((k) => message.includes(k));
  if (!known) return fallback;
  // Validation codes carry the scheme's own reason after the colon.
  if (
    known === 'invalid_registration_number' ||
    known === 'invalid_vat_number' ||
    known === 'invalid_address'
  ) {
    const reason = message.split(`${known}: `)[1]?.split('\n')[0];
    if (reason) return reason;
  }
  return COMPANY_ERROR_MESSAGES[known];
}
