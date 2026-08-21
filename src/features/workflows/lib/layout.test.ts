import { describe, expect, it } from 'bun:test';
import type { WorkflowNode } from '@crm/lib/backend';
import type { WorkflowDraft } from '../types';
import { draftReducer, emptyDraft, subtreeIds } from '../hooks/useWorkflowDraft';
import { layoutWorkflow, NODE_W, ROW_H, X_GAP } from './layout';

const draftWith = (nodes: WorkflowNode[], startNodeId: string | null): WorkflowDraft => ({
  ...emptyDraft(),
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  startNodeId,
});

const wait = (id: string, next?: string): WorkflowNode => ({
  id,
  type: 'wait',
  amount: 1,
  unit: 'days',
  next,
});

const branch = (id: string, nextTrue?: string, nextFalse?: string): WorkflowNode => ({
  id,
  type: 'branch',
  condition: { combinator: 'and', groups: [] },
  nextTrue,
  nextFalse,
});

describe('layoutWorkflow', () => {
  it('renders trigger + terminal add node for an empty graph', () => {
    const { nodes, edges } = layoutWorkflow(emptyDraft());
    expect(nodes.map((n) => n.id)).toEqual(['trigger', 'add:trigger']);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe('trigger');
  });

  it('stacks a linear chain in one centered column', () => {
    const draft = draftWith([wait('a', 'b'), wait('b')], 'a');
    const { nodes } = layoutWorkflow(draft);
    const a = nodes.find((n) => n.id === 'a')!;
    const b = nodes.find((n) => n.id === 'b')!;
    expect(a.position.x).toBe(-NODE_W / 2);
    expect(b.position.x).toBe(-NODE_W / 2);
    expect(a.position.y).toBe(ROW_H);
    expect(b.position.y).toBe(2 * ROW_H);
    // Chain still ends with a "+" node.
    expect(nodes.some((n) => n.id === 'add:b:next')).toBe(true);
  });

  it('splits branch children symmetrically with Oui/Non labels', () => {
    const draft = draftWith([branch('br', 'a', undefined), wait('a')], 'br');
    const { nodes, edges } = layoutWorkflow(draft);
    const a = nodes.find((n) => n.id === 'a')!;
    const add = nodes.find((n) => n.id === 'add:br:nextFalse')!;
    // True child left of center, false "+" right of center, a full column apart.
    const aCenter = a.position.x + NODE_W / 2;
    expect(aCenter).toBe(-(NODE_W + X_GAP) / 2);
    expect(add.position.x).toBeGreaterThan(aCenter);
    const labels = edges.map((e) => (e.data as { branchLabel?: string }).branchLabel);
    expect(labels).toContain('Oui');
    expect(labels).toContain('Non');
  });

  it('widens ancestors to fit nested branches', () => {
    const draft = draftWith([branch('outer', 'inner', undefined), branch('inner')], 'outer');
    const { nodes } = layoutWorkflow(draft);
    // inner branch subtree = two "+" columns; outer's false "+" must clear it.
    const innerFalseAdd = nodes.find((n) => n.id === 'add:inner:nextFalse')!;
    const outerFalseAdd = nodes.find((n) => n.id === 'add:outer:nextFalse')!;
    expect(outerFalseAdd.position.x).toBeGreaterThan(innerFalseAdd.position.x);
  });
});

describe('draftReducer', () => {
  it('splices a node in after the trigger', () => {
    let state = { draft: draftWith([wait('a')], 'a'), lastInsertedId: null as string | null };
    state = draftReducer(state, {
      type: 'insertNode',
      slot: { parentId: 'trigger' },
      nodeType: 'send_sms',
      id: 'new',
    });
    expect(state.draft.startNodeId).toBe('new');
    expect(state.draft.nodes.new).toMatchObject({ type: 'send_sms', next: 'a' });
    expect(state.lastInsertedId).toBe('new');
  });

  it('inserting a branch mid-chain keeps the chain on the Oui side', () => {
    let state = {
      draft: draftWith([wait('a', 'b'), wait('b')], 'a'),
      lastInsertedId: null as string | null,
    };
    state = draftReducer(state, {
      type: 'insertNode',
      slot: { parentId: 'a', slot: 'next' },
      nodeType: 'branch',
      id: 'br',
    });
    expect(state.draft.nodes.a).toMatchObject({ next: 'br' });
    expect(state.draft.nodes.br).toMatchObject({ nextTrue: 'b' });
  });

  it('removing a linear node splices its child up', () => {
    let state = {
      draft: draftWith([wait('a', 'b'), wait('b', 'c'), wait('c')], 'a'),
      lastInsertedId: null as string | null,
    };
    state = draftReducer(state, { type: 'removeNode', id: 'b' });
    expect(state.draft.nodes.a).toMatchObject({ next: 'c' });
    expect(state.draft.nodes.b).toBeUndefined();
  });

  it('removing a branch removes its whole subtree', () => {
    let state = {
      draft: draftWith([wait('a', 'br'), branch('br', 't', 'f'), wait('t'), wait('f')], 'a'),
      lastInsertedId: null as string | null,
    };
    expect(subtreeIds(state.draft.nodes, 'br').sort()).toEqual(['br', 'f', 't']);
    state = draftReducer(state, { type: 'removeNode', id: 'br' });
    expect(Object.keys(state.draft.nodes)).toEqual(['a']);
    expect(state.draft.nodes.a).toMatchObject({ next: undefined });
  });

  it('removing the start node clears startNodeId', () => {
    let state = { draft: draftWith([wait('a')], 'a'), lastInsertedId: null as string | null };
    state = draftReducer(state, { type: 'removeNode', id: 'a' });
    expect(state.draft.startNodeId).toBeNull();
  });
});
