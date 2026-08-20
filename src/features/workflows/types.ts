import type { AdvancedFilter, Workflow, WorkflowNode, WorkflowTrigger } from '@crm/lib/backend';

/**
 * The editor's local working copy of a workflow (draft-then-commit, like the
 * advanced filter builder). Nodes are kept as a map for O(1) graph edits; the
 * stored shape is the backend's `nodes: WorkflowNode[]` + `startNodeId`.
 */
export interface WorkflowDraft {
  name: string;
  description?: string;
  trigger: WorkflowTrigger | null;
  enrollmentCriteria?: AdvancedFilter;
  allowReEnrollment: boolean;
  nodes: Record<string, WorkflowNode>;
  startNodeId: string | null;
}

/** Where a "+" insert affordance points: after the trigger, or a node's slot. */
export type InsertSlot =
  | { parentId: 'trigger' }
  | { parentId: string; slot: 'next' | 'nextTrue' | 'nextFalse' };

/** The stored doc shape the editor loads from / saves to. */
export type WorkflowPayload = Pick<
  Workflow,
  'name' | 'description' | 'trigger' | 'enrollmentCriteria' | 'allowReEnrollment' | 'nodes'
> & { startNodeId?: string };

export function draftFromWorkflow(
  workflow: Pick<
    Workflow,
    'name' | 'description' | 'trigger' | 'enrollmentCriteria' | 'allowReEnrollment' | 'nodes' | 'startNodeId'
  >
): WorkflowDraft {
  return {
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger,
    enrollmentCriteria: workflow.enrollmentCriteria,
    allowReEnrollment: workflow.allowReEnrollment,
    nodes: Object.fromEntries(workflow.nodes.map((n) => [n.id, n])),
    startNodeId: workflow.startNodeId ?? null,
  };
}

/** Serialize a draft for create/updateWorkflow. Requires a chosen trigger. */
export function draftToPayload(draft: WorkflowDraft, trigger: WorkflowTrigger): WorkflowPayload {
  return {
    name: draft.name,
    description: draft.description,
    trigger,
    enrollmentCriteria: draft.enrollmentCriteria,
    allowReEnrollment: draft.allowReEnrollment,
    nodes: Object.values(draft.nodes),
    startNodeId: draft.startNodeId ?? undefined,
  };
}
