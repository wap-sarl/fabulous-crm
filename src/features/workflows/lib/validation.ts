import { isActiveRule } from '@crm/lib/backend';
import type { WorkflowDraft } from '../types';
import { STEP_TYPE_META } from './constants';

export interface DraftError {
  message: string;
  /** Offending node, when the error is step-specific ('trigger' for the trigger). */
  nodeId?: string;
}

/**
 * Pre-activation validation of the editor draft, mirroring the backend's
 * `validateWorkflowGraph` messages so the user fixes everything client-side.
 * « Enregistrer » only needs a name; « Activer » requires an empty result here.
 */
export function validateWorkflowDraft(draft: WorkflowDraft): DraftError[] {
  const errors: DraftError[] = [];

  if (!draft.name.trim()) errors.push({ message: 'Le nom du workflow est requis.' });
  if (!draft.trigger) {
    errors.push({ message: 'Choisissez un événement déclencheur.', nodeId: 'trigger' });
  }
  if (!draft.startNodeId || Object.keys(draft.nodes).length === 0) {
    errors.push({ message: 'Ajoutez au moins une étape.' });
  }

  for (const node of Object.values(draft.nodes)) {
    const label = `Étape « ${STEP_TYPE_META.get(node.type)?.label ?? node.type} »`;
    const push = (detail: string) => errors.push({ message: `${label} : ${detail}`, nodeId: node.id });

    switch (node.type) {
      case 'send_email':
        if (!node.subject.trim()) push('l’objet est requis.');
        else if (!node.htmlBody.trim() || node.htmlBody === '<p></p>') push('le contenu est requis.');
        break;
      case 'send_sms':
        if (!node.smsBody.trim()) push('le message est requis.');
        break;
      case 'update_property':
        if (node.value === '' || (Array.isArray(node.value) && node.value.length === 0)) {
          push('choisissez une valeur.');
        }
        break;
      case 'add_to_list':
      case 'remove_from_list':
        if (!node.listId) push('choisissez une liste.');
        break;
      case 'wait':
        if (!Number.isInteger(node.amount) || node.amount < 1) push('durée invalide.');
        else if (node.unit === 'days' && node.amount > 90) push('durée maximale 90 jours.');
        break;
      case 'webhook':
        if (!/^https?:\/\/.+/.test(node.url)) push('l’URL doit commencer par http(s)://');
        break;
      case 'branch': {
        const active = node.condition.groups.reduce(
          (n, g) => n + g.rules.filter(isActiveRule).length,
          0
        );
        if (active === 0) push('au moins une condition est requise.');
        break;
      }
    }
  }

  return errors;
}

/** Ids of nodes with at least one validation error (for canvas badges). */
export function invalidNodeIds(errors: DraftError[]): Set<string> {
  return new Set(errors.flatMap((e) => (e.nodeId && e.nodeId !== 'trigger' ? [e.nodeId] : [])));
}
