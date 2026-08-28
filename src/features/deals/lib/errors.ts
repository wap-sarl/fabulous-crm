/** French messages for the deal / pipeline mutations' error codes. */
export const DEAL_ERROR_MESSAGES: Record<string, string> = {
  deal_title_required: 'L’intitulé de la transaction est requis.',
  deal_not_found: 'Transaction introuvable.',
  pipeline_not_found: 'Pipeline introuvable.',
  unknown_stage: 'Stade introuvable dans ce pipeline.',
  lead_not_found: 'Lead introuvable.',
  company_not_found: 'Entreprise introuvable.',
  'invalid_deal: amount': 'Montant invalide.',
  'invalid_deal: currency': 'Devise invalide (code ISO à 3 lettres).',
  'invalid_deal: expectedCloseDate': 'Date de clôture invalide.',
  pipeline_name_required: 'Le nom du pipeline est requis.',
  pipeline_no_stages: 'Au moins un stade est requis.',
  pipeline_too_many_stages: 'Trop de stades (20 max).',
  pipeline_invalid_key: 'Identifiant de stade invalide.',
  pipeline_duplicate_key: 'Deux stades partagent le même identifiant.',
  pipeline_empty_label: 'Chaque stade doit avoir un libellé.',
  pipeline_no_open_stage: 'Le pipeline doit avoir au moins un stade en cours.',
  pipeline_no_won_stage: 'Le pipeline doit se terminer par le stade « gagnée ».',
  pipeline_no_lost_stage: 'Le pipeline doit se terminer par le stade « perdue ».',
  pipeline_closed_stage_misplaced: 'Les stades gagnée / perdue doivent rester en fin de pipeline.',
  pipeline_stage_in_use: 'Impossible de supprimer un stade qui contient encore des transactions.',
  pipeline_in_use: 'Impossible de supprimer un pipeline qui contient des transactions.',
  pipeline_transition_unknown_stage: 'Une transition référence un stade inconnu.',
  pipeline_transition_self_loop: 'Un stade ne peut pas mener à lui-même.',
  pipeline_transition_duplicate: 'Une transition est déclarée deux fois.',
  pipeline_transition_from_closed:
    'Un stade gagnée / perdue ne peut mener qu’à un stade en cours (réouverture).',
  deal_transition_forbidden: 'Cette transition n’est pas autorisée par le pipeline.',
};

export function dealErrorMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : '';
  const known = Object.keys(DEAL_ERROR_MESSAGES)
    .sort((a, b) => b.length - a.length)
    .find((k) => message.includes(k));
  return known ? DEAL_ERROR_MESSAGES[known] : fallback;
}
