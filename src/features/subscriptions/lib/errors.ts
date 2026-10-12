import { errorLabel } from '@crm/lib/errors';

const SUBSCRIPTION_ERROR_MESSAGES: Record<string, string> = {
  subscription_name_invalid: 'Le nom est requis (80 caractères au plus).',
  subscription_description_invalid: 'La description dépasse 500 caractères.',
  subscription_type_not_found: 'Cet abonnement n’existe plus.',
  invalid_subscription_order: 'L’ordre reçu ne correspond pas à la liste.',
};

export const subscriptionErrorMessage = (error: unknown, fallback: string) =>
  errorLabel(error, SUBSCRIPTION_ERROR_MESSAGES, fallback);
