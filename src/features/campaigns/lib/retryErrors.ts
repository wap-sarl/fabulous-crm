import { errorCode } from '@crm/lib/errors';

const RETRY_ERRORS: Record<string, string> = {
  campaign_sending: 'Un envoi est déjà en cours. Réessayez une fois terminé.',
  send_pending: 'Cet envoi est déjà en file d’attente.',
  no_contact: "Ce destinataire n'a pas de coordonnée (e-mail/téléphone) pour l'envoi.",
  link_base_missing: 'Configuration manquante : impossible de générer les liens de suivi.',
  send_not_found: 'Envoi introuvable.',
  campaign_not_found: 'Campagne introuvable.',
};

/** Map a resend mutation error to a user-facing French message. */
export function retryErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  const code = errorCode(err, RETRY_ERRORS);
  if (code) return RETRY_ERRORS[code];
  // The provider guards throw already-French, user-facing messages.
  if (raw.includes('fournisseur')) {
    return "Aucun fournisseur d'e-mail n'est configuré. Configurez-le dans Paramètres → E-mail.";
  }
  if (raw.includes('compte Brevo')) {
    return 'Les campagnes SMS nécessitent un compte Brevo configuré.';
  }
  return "L'action a échoué. Veuillez réessayer.";
}
