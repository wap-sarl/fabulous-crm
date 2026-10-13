import { errorLabel } from '@crm/lib/errors';

const TEMPLATE_ERROR_MESSAGES: Record<string, string> = {
  template_name_invalid: 'Le nom est requis (80 caractères au plus).',
  template_subject_invalid: 'L’objet est requis (200 caractères au plus).',
  template_body_invalid: 'Le contenu est requis.',
  template_category_invalid: 'La catégorie dépasse 40 caractères.',
  template_not_found: 'Ce modèle n’existe plus ou n’est pas dans votre périmètre.',
  template_forbidden:
    'Seul son auteur, ou un détenteur du droit Paramètres, peut modifier ce modèle.',
  snippet_name_invalid: 'Le nom est requis (80 caractères au plus).',
  snippet_shortcut_invalid:
    'Le raccourci commence par / et ne contient que des minuscules, des chiffres et des tirets.',
  snippet_text_invalid: 'Le texte est requis (2 000 caractères au plus).',
  snippet_shortcut_taken: 'Ce raccourci est déjà pris.',
  snippet_not_found: 'Ce bloc n’existe plus.',
  snippet_forbidden: 'Seul son auteur, ou un détenteur du droit Paramètres, peut modifier ce bloc.',
};

export const templateErrorMessage = (error: unknown, fallback: string) =>
  errorLabel(error, TEMPLATE_ERROR_MESSAGES, fallback);
