import { useReducer } from 'react';
import type {
  AdvancedFilter,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowTrigger,
} from '@crm/lib/backend';
import { emptyAdvancedFilter } from '../../leads/lib/advancedFilter';
import type { InsertSlot, WorkflowDraft } from '../types';

/**
 * Local editor state of a workflow (draft-then-commit: nothing is persisted
 * until « Enregistrer »). Graph edits are splice-in/splice-out on the flat
 * node map; deleting a branch removes its whole subtree (reattaching two
 * children to one slot would be ambiguous).
 */

export function emptyDraft(): WorkflowDraft {
  return {
    name: '',
    description: undefined,
    trigger: null,
    enrollmentCriteria: undefined,
    allowReEnrollment: false,
    nodes: {},
    startNodeId: null,
  };
}

/** A freshly inserted node with a sensible empty config. */
function emptyNode(type: WorkflowNodeType, id: string): WorkflowNode {
  switch (type) {
    case 'send_email':
      return { id, type, subject: '', htmlBody: '' };
    case 'send_sms':
      return { id, type, smsBody: '' };
    case 'update_property':
      return { id, type, target: { kind: 'standard', field: 'comment' }, value: '' };
    case 'set_lifecycle_stage':
      return { id, type, stage: undefined };
    case 'create_deal':
      return { id, type, title: 'Transaction {{ params.firstName }} {{ params.lastName }}' };
    case 'update_deal_stage':
      return { id, type, stageKey: undefined };
    case 'create_task':
      return {
        id,
        type,
        title: 'Rappeler {{ params.firstName }} {{ params.lastName }}',
        dueInDays: 1,
      };
    case 'add_to_list':
    case 'remove_from_list':
      return { id, type, listId: undefined };
    case 'wait':
      return { id, type, amount: 1, unit: 'days' };
    case 'webhook':
      return { id, type, url: '' };
    case 'branch':
      return { id, type, condition: emptyAdvancedFilter() };
  }
}

/** The node id an insert slot currently points at (spliced onto the new node). */
function slotTarget(draft: WorkflowDraft, slot: InsertSlot): string | undefined {
  if (slot.parentId === 'trigger') return draft.startNodeId ?? undefined;
  const parent = draft.nodes[slot.parentId];
  if (!parent) return undefined;
  if (parent.type === 'branch') {
    if (!('slot' in slot)) return undefined;
    return slot.slot === 'nextTrue' ? parent.nextTrue : parent.nextFalse;
  }
  return parent.next;
}

/** Re-point an insert slot (trigger start or a parent's next/branch slot). */
function setSlot(
  draft: WorkflowDraft,
  slot: InsertSlot,
  target: string | undefined,
): WorkflowDraft {
  if (slot.parentId === 'trigger') {
    return { ...draft, startNodeId: target ?? null };
  }
  const parent = draft.nodes[slot.parentId];
  if (!parent) return draft;
  let updated: WorkflowNode;
  if (parent.type === 'branch' && 'slot' in slot && slot.slot !== 'next') {
    updated =
      slot.slot === 'nextTrue' ? { ...parent, nextTrue: target } : { ...parent, nextFalse: target };
  } else if (parent.type !== 'branch') {
    updated = { ...parent, next: target };
  } else {
    return draft;
  }
  return { ...draft, nodes: { ...draft.nodes, [parent.id]: updated } };
}

/** The slot currently pointing at `id`, if any. */
function findParentSlot(draft: WorkflowDraft, id: string): InsertSlot | null {
  if (draft.startNodeId === id) return { parentId: 'trigger' };
  for (const node of Object.values(draft.nodes)) {
    if (node.type === 'branch') {
      if (node.nextTrue === id) return { parentId: node.id, slot: 'nextTrue' };
      if (node.nextFalse === id) return { parentId: node.id, slot: 'nextFalse' };
    } else if (node.next === id) {
      return { parentId: node.id, slot: 'next' };
    }
  }
  return null;
}

/** `id` and every node reachable below it. */
export function subtreeIds(nodes: Record<string, WorkflowNode>, id: string): string[] {
  const node = nodes[id];
  if (!node) return [];
  const children =
    node.type === 'branch'
      ? [node.nextTrue, node.nextFalse].filter((c): c is string => c !== undefined)
      : node.next !== undefined
        ? [node.next]
        : [];
  return [id, ...children.flatMap((c) => subtreeIds(nodes, c))];
}

interface DraftState {
  draft: WorkflowDraft;
  /** Id of the last inserted node, so the editor can auto-open its config. */
  lastInsertedId: string | null;
}

type DraftAction =
  | { type: 'init'; draft: WorkflowDraft }
  | { type: 'setName'; name: string }
  | { type: 'setTrigger'; trigger: WorkflowTrigger | null }
  | { type: 'setEnrollmentCriteria'; filter: AdvancedFilter | undefined }
  | { type: 'setAllowReEnrollment'; value: boolean }
  | { type: 'insertNode'; slot: InsertSlot; nodeType: WorkflowNodeType; id: string }
  | { type: 'updateNode'; node: WorkflowNode }
  | { type: 'removeNode'; id: string };

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  const { draft } = state;
  switch (action.type) {
    case 'init':
      return { draft: action.draft, lastInsertedId: null };
    case 'setName':
      return { ...state, draft: { ...draft, name: action.name } };
    case 'setTrigger':
      return { ...state, draft: { ...draft, trigger: action.trigger } };
    case 'setEnrollmentCriteria':
      return { ...state, draft: { ...draft, enrollmentCriteria: action.filter } };
    case 'setAllowReEnrollment':
      return { ...state, draft: { ...draft, allowReEnrollment: action.value } };

    case 'insertNode': {
      const node = emptyNode(action.nodeType, action.id);
      const target = slotTarget(draft, action.slot);
      // Splice-in: the new node takes over the slot's previous continuation.
      // A branch inserted mid-chain keeps the existing chain on its « Oui » side.
      const withNext: WorkflowNode =
        node.type === 'branch' ? { ...node, nextTrue: target } : { ...node, next: target };
      const withNode = { ...draft, nodes: { ...draft.nodes, [action.id]: withNext } };
      return { draft: setSlot(withNode, action.slot, action.id), lastInsertedId: action.id };
    }

    case 'updateNode': {
      if (!draft.nodes[action.node.id]) return state;
      return {
        ...state,
        draft: { ...draft, nodes: { ...draft.nodes, [action.node.id]: action.node } },
      };
    }

    case 'removeNode': {
      const node = draft.nodes[action.id];
      if (!node) return state;
      const parentSlot = findParentSlot(draft, action.id);

      // Splice-out for linear nodes; a branch takes its whole subtree with it.
      const removedIds = node.type === 'branch' ? subtreeIds(draft.nodes, action.id) : [action.id];
      const nodes = { ...draft.nodes };
      for (const id of removedIds) delete nodes[id];

      let next = { ...draft, nodes };
      if (parentSlot) {
        next = setSlot(next, parentSlot, node.type === 'branch' ? undefined : node.next);
      }
      return {
        draft: next,
        lastInsertedId: state.lastInsertedId === action.id ? null : state.lastInsertedId,
      };
    }
  }
}

export function useWorkflowDraft() {
  return useReducer(draftReducer, { draft: emptyDraft(), lastInsertedId: null });
}
