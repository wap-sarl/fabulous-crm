import { errorLabel } from '@crm/lib/errors';
const ROLE_ERRORS: Record<string, string> = {
  role_label_required: 'Le nom du rôle est requis.',
  role_label_too_long: 'Nom trop long.',
  role_label_invalid: 'Ce nom ne donne pas de clé valide.',
  role_admin_locked: 'Le rôle Administrateur ne peut pas être restreint.',
  role_built_in: 'Un rôle intégré ne peut pas être supprimé.',
  role_in_use: 'Ce rôle est encore utilisé : choisissez un rôle de remplacement.',
  role_lock_out: 'Vous ne pouvez pas retirer « Paramètres » à votre propre rôle.',
  role_not_found: 'Ce rôle n’existe plus.',
};

export const roleErrorMessage = (e: unknown) =>
  errorLabel(e, ROLE_ERRORS, 'Une erreur est survenue.');
