import type { LeadAdvancedFilter, Workflow, WorkflowNode, WorkflowTrigger } from '@crm/lib/backend';
import { withSmsCompliance } from '../campaigns/lib/marketingCompliance';

/** The editor's working copy, committed on save: nodes are a map for cheap graph edits, while the backend stores an array. */
export interface WorkflowDraft {
  name: string;
  description?: string;
  trigger: WorkflowTrigger | null;
  enrollmentCriteria?: LeadAdvancedFilter;
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
    | 'name'
    | 'description'
    | 'trigger'
    | 'enrollmentCriteria'
    | 'allowReEnrollment'
    | 'nodes'
    | 'startNodeId'
  >,
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
    // Every SMS leaves with the STOP line, whatever the author did to it.
    nodes: Object.values(draft.nodes).map((node) =>
      node.type === 'send_sms' ? { ...node, smsBody: withSmsCompliance(node.smsBody) } : node,
    ),
    startNodeId: draft.startNodeId ?? undefined,
  };
}
