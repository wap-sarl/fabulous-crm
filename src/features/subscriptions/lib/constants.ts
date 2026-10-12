import type { LegalBasis } from '@crm/lib/backend';

export const LEGAL_BASIS_LABEL: Record<LegalBasis, string> = {
  consent: 'Consentement',
  legitimate_interest: 'Intérêt légitime',
};

/** What each basis means for the person, said on the preference centre. */
export const LEGAL_BASIS_WORDING: Record<LegalBasis, string> = {
  consent: 'Envoyé uniquement avec votre accord, que vous pouvez retirer à tout moment.',
  legitimate_interest:
    'Envoyé au titre de notre intérêt légitime tant que vous acceptez ce canal ; vous pouvez vous y opposer à tout moment.',
};
