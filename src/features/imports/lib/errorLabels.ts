import { ConvexError, type Value } from 'convex/values';
import { describeError } from '@crm/lib/errors';

/** The importers' error codes as the report shows them; anything else stays as it came. */
const LABELS: [string, string][] = [
  ['unknown_lifecycle_stage', 'Statut inconnu'],
  ['unknown_stage', 'Étape inconnue dans ce pipeline'],
  ['pipeline_not_found', 'Pipeline introuvable'],
  ['contact_not_found', 'Contact introuvable (e-mail inconnu ou fiche supprimée)'],
  ['company_not_found', 'Entreprise introuvable (nom inconnu)'],
  ['company_name_required', 'Nom de l’entreprise requis'],
  ['deal_title_required', 'Titre de la transaction requis'],
  ['activity_title_required', 'Titre de l’activité requis'],
  ['deal_in_other_pipeline', 'La transaction existante est dans un autre pipeline'],
  ['stage_move_forbidden', 'Passage d’étape non autorisé par le pipeline'],
  ['stage_move_tag_required', 'L’étape demande une étiquette'],
  ['stage_move_unknown_tag', 'Étiquette d’étape inconnue'],
  ['company_registration_exists', 'Ce n° d’immatriculation appartient à une autre entreprise'],
  ['company_vat_exists', 'Ce n° de TVA appartient à une autre entreprise'],
  ['company_domain_exists', 'Ce domaine appartient à une autre entreprise'],
  ['invalid_registration_number', 'N° d’immatriculation invalide'],
  ['invalid_vat_number', 'N° de TVA invalide'],
  ['invalid_domain', 'Domaine invalide'],
  ['invalid_country', 'Code pays invalide'],
  ['invalid_owner', 'Responsable inconnu'],
  ['invalid_deal: amount', 'Montant invalide'],
  ['invalid_deal: currency', 'Devise invalide'],
  ['invalid_deal: expectedCloseDate', 'Date de clôture invalide'],
  ['invalid_property_value', 'Valeur de propriété invalide'],
  ['invalid_address', 'Adresse invalide'],
  ['invalid_row', 'Ligne invalide'],
];

/** A row's error as a sentence: a known code (with its detail after the colon kept), else the text as it came. */
export function describeImportError(error: string): string {
  const match = LABELS.find(([code]) => error === code || error.startsWith(`${code}:`));
  if (!match) return error;
  const detail = error.slice(match[0].length).replace(/^:\s*/, '');
  return detail ? `${match[1]} (${detail})` : match[1];
}

/**
 * The error that interrupted a job as a sentence. The batch stores a refusal as its JSON (`{ code, … }`), so the
 * overlay can word it as it words a toast; anything else is a plain message.
 */
export function describeJobError(error: string): string {
  try {
    const parsed: unknown = JSON.parse(error);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { code?: unknown }).code === 'string'
    ) {
      const code = (parsed as { code: string }).code;
      return describeError(new ConvexError(parsed as Value), describeImportError(code));
    }
  } catch {
    // Not JSON: a plain message.
  }
  return describeError(error, describeImportError(error));
}
