import { errorLabel } from '@crm/lib/errors';

const PAGE_ERRORS: Record<string, string> = {
  page_name_required: 'Le nom de la page est requis.',
  page_invalid_slug: 'L’adresse n’admet que des minuscules, des chiffres et des tirets.',
  page_slug_taken: 'Une autre page a déjà cette adresse.',
  page_title_required: 'Le titre de la page est requis.',
  page_title_too_long: 'Le titre dépasse 70 caractères.',
  page_description_too_long: 'La description dépasse 160 caractères.',
  page_invalid_url: 'Une adresse doit commencer par http(s)://, ou mener au formulaire.',
  page_invalid_image_url: 'L’adresse d’une image commence par https://.',
  page_too_many_sections: 'Trop de blocs.',
  page_duplicate_section: 'Un bloc apparaît deux fois.',
  page_heading_required: 'Chaque bandeau et chaque appel à l’action a un titre.',
  page_text_required: 'Un bloc de texte ne peut pas être vide.',
  page_label_required: 'Un appel à l’action a un bouton.',
  page_form_unknown: 'Le formulaire d’un bloc n’existe plus.',
  page_sections_required: 'Ajoutez au moins un bloc avant de publier.',
  page_form_required: 'Un bouton mène au formulaire : ajoutez un bloc formulaire.',
  page_not_found: 'Cette page n’existe plus.',
};

export const pageErrorMessage = (error: unknown) =>
  errorLabel(error, PAGE_ERRORS, 'Échec de l’enregistrement de la page.');
