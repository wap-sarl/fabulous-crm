import type { Edge, Node } from '@xyflow/react';
import type { WorkflowNode, WorkflowTrigger } from '@crm/lib/backend';
import type { InsertSlot, WorkflowDraft } from '../types';

export const NODE_W = 280;
export const NODE_H = 84;
export const ADD_SIZE = 36;
export const ROW_H = 164;
export const X_GAP = 48;

export interface TriggerNodeData {
  trigger: WorkflowTrigger | null;
  criteriaCount: number;
  [key: string]: unknown;
}
export interface StepNodeData {
  node: WorkflowNode;
  invalid: boolean;
  [key: string]: unknown;
}
export interface AddNodeData {
  slot: InsertSlot;
  [key: string]: unknown;
}
export interface InsertEdgeData {
  slot: InsertSlot;
  branchLabel?: 'Oui' | 'Non';
  [key: string]: unknown;
}

const slotKey = (slot: InsertSlot): string =>
  'slot' in slot ? `${slot.parentId}:${slot.slot}` : 'trigger';

export function layoutWorkflow(
  draft: WorkflowDraft,
  opts?: { invalidIds?: Set<string>; criteriaCount?: number },
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const invalidIds = opts?.invalidIds ?? new Set<string>();

  /** Subtree width, in px. An empty slot counts its « + » node as a full column. */
  const measure = (id: string | undefined): number => {
    if (id === undefined) return NODE_W;
    const node = draft.nodes[id];
    if (!node) return NODE_W;
    if (node.type === 'branch') {
      return measure(node.nextTrue) + X_GAP + measure(node.nextFalse);
    }
    return measure(node.next);
  };

  const addEdge = (
    sourceId: string,
    targetId: string,
    slot: InsertSlot,
    branchLabel?: 'Oui' | 'Non',
  ) => {
    edges.push({
      id: `e:${sourceId}->${targetId}`,
      source: sourceId,
      target: targetId,
      type: 'insert',
      data: { slot, branchLabel } satisfies InsertEdgeData,
    });
  };

  /** Place the subtree hanging off `slot` with its column centered on `centerX`. */
  const place = (
    id: string | undefined,
    centerX: number,
    row: number,
    sourceId: string,
    slot: InsertSlot,
    branchLabel?: 'Oui' | 'Non',
  ): void => {
    if (id === undefined || !draft.nodes[id]) {
      const addId = `add:${slotKey(slot)}`;
      nodes.push({
        id: addId,
        type: 'add',
        position: { x: centerX - ADD_SIZE / 2, y: row * ROW_H },
        data: { slot } satisfies AddNodeData,
        width: ADD_SIZE,
        height: ADD_SIZE,
        draggable: false,
        selectable: false,
      });
      addEdge(sourceId, addId, slot, branchLabel);
      return;
    }

    const node = draft.nodes[id];
    nodes.push({
      id,
      type: 'step',
      position: { x: centerX - NODE_W / 2, y: row * ROW_H },
      data: { node, invalid: invalidIds.has(id) } satisfies StepNodeData,
      width: NODE_W,
      height: NODE_H,
      draggable: false,
    });
    addEdge(sourceId, id, slot, branchLabel);

    if (node.type === 'branch') {
      const wTrue = measure(node.nextTrue);
      const wFalse = measure(node.nextFalse);
      const total = wTrue + X_GAP + wFalse;
      place(
        node.nextTrue,
        centerX - total / 2 + wTrue / 2,
        row + 1,
        id,
        { parentId: id, slot: 'nextTrue' },
        'Oui',
      );
      place(
        node.nextFalse,
        centerX + total / 2 - wFalse / 2,
        row + 1,
        id,
        { parentId: id, slot: 'nextFalse' },
        'Non',
      );
      return;
    }

    place(node.next, centerX, row + 1, id, { parentId: id, slot: 'next' });
  };

  nodes.push({
    id: 'trigger',
    type: 'trigger',
    position: { x: -NODE_W / 2, y: 0 },
    data: {
      trigger: draft.trigger,
      criteriaCount: opts?.criteriaCount ?? 0,
    } satisfies TriggerNodeData,
    width: NODE_W,
    height: NODE_H,
    draggable: false,
  });

  place(draft.startNodeId ?? undefined, 0, 1, 'trigger', { parentId: 'trigger' });

  return { nodes, edges };
}
