import { errorLabel } from '@crm/lib/errors';

const RETRY_ERRORS: Record<string, string> = {
  campaign_sending: 'Un envoi est déjà en cours. Réessayez une fois terminé.',
  send_pending: 'Cet envoi est déjà en file d’attente.',
  no_contact: "Ce destinataire n'a pas de coordonnée (e-mail/téléphone) pour l'envoi.",
  link_base_missing: 'Configuration manquante : impossible de générer les liens de suivi.',
  send_not_found: 'Envoi introuvable.',
  campaign_not_found: 'Campagne introuvable.',
  email_provider_required:
    "Aucun fournisseur d'e-mail n'est configuré. Configurez-le dans Paramètres → E-mail.",
  sms_provider_required: 'Les campagnes SMS nécessitent un compte Brevo configuré.',
};

/** Map a resend mutation error to a user-facing French message. */
export function retryErrorMessage(err: unknown): string {
  return errorLabel(err, RETRY_ERRORS, "L'action a échoué. Veuillez réessayer.");
}
