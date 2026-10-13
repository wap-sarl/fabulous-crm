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
  campaign_not_schedulable: 'Cette campagne est déjà partie : elle ne peut plus être programmée.',
  campaign_not_scheduled: 'Cette campagne n’est pas programmée.',
  campaign_not_sending: 'Cette campagne n’est pas en cours d’envoi.',
  campaign_not_stopped: 'Cette campagne n’est pas arrêtée.',
  schedule_time_invalid: 'L’heure d’envoi doit être à venir, dans l’année.',
};

/** Map a resend mutation error to a user-facing French message. */
export function retryErrorMessage(err: unknown): string {
  return errorLabel(err, RETRY_ERRORS, "L'action a échoué. Veuillez réessayer.");
}
