import { NO_STEP_ISSUE, stepIssue, stepIssueMessage } from '@crm/lib/backend';
import type { WorkflowDraft } from '../types';

export interface DraftError {
  message: string;
  /** Offending node, when the error is step-specific ('trigger' for the trigger). */
  nodeId?: string;
}

/** The steps follow the rules the backend activates with (`stepIssue`); saving only needs a name, activating needs an empty result here. */
export function validateWorkflowDraft(draft: WorkflowDraft): DraftError[] {
  const errors: DraftError[] = [];

  if (!draft.name.trim()) errors.push({ message: 'Le nom du workflow est requis.' });
  if (!draft.trigger) {
    errors.push({ message: 'Choisissez un événement déclencheur.', nodeId: 'trigger' });
  }
  if (!draft.startNodeId || Object.keys(draft.nodes).length === 0) {
    errors.push({ message: NO_STEP_ISSUE });
  }

  for (const node of Object.values(draft.nodes)) {
    const issue = stepIssue(node);
    if (issue) errors.push({ message: stepIssueMessage(node, issue), nodeId: node.id });
  }

  return errors;
}

/** Ids of nodes with at least one validation error (for canvas badges). */
export function invalidNodeIds(errors: DraftError[]): Set<string> {
  return new Set(errors.flatMap((e) => (e.nodeId && e.nodeId !== 'trigger' ? [e.nodeId] : [])));
}
