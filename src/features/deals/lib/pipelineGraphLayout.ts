import type { Node } from '@xyflow/react';
import type { PipelineLayout } from '@crm/lib/backend';
import type { GraphMode, GraphPoint, StageNodeData, StageSkeleton } from '../types';

export const NODE_W = 176;
export const NODE_H = 58;

/** Linear graph: open stages top to bottom, won and lost side by side under the last one. */
function layoutColumn(stages: StageSkeleton[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const step = NODE_H + 64;
  const open = stages.filter((s) => s.kind === 'open');
  for (const [i, s] of open.entries()) positions.set(s.key, { x: 0, y: i * step });
  const closed = stages.filter((s) => s.kind !== 'open');
  const width = closed.length * NODE_W + (closed.length - 1) * 40;
  for (const [i, s] of closed.entries()) {
    positions.set(s.key, {
      x: NODE_W / 2 - width / 2 + i * (NODE_W + 40),
      y: open.length * step + 24,
    });
  }
  return positions;
}

/** Any-to-any graph: stages on a circle, clockwise from the top in pipeline order. */
function layoutCircle(stages: StageSkeleton[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const radius = Math.max(190, stages.length * 42);
  for (const [i, s] of stages.entries()) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / stages.length;
    positions.set(s.key, {
      x: Math.round(Math.cos(angle) * radius - NODE_W / 2),
      y: Math.round(Math.sin(angle) * radius - NODE_H / 2),
    });
  }
  return positions;
}

export function layoutStages(stages: StageSkeleton[], mode: GraphMode) {
  return mode === 'default' ? layoutColumn(stages) : layoutCircle(stages);
}

/** A saved layout usable for these stages (every stage placed), split into positions and pulls. */
export function storedLayout(layout: PipelineLayout | undefined, stages: StageSkeleton[]) {
  if (!layout) return null;
  const positions = new Map(layout.nodes.map((n) => [n.key, { x: n.x, y: n.y }]));
  if (!stages.every((s) => positions.has(s.key))) return null;
  const bends = new Map(layout.arrows.map((a) => [`${a.from}->${a.to}`, { x: a.x, y: a.y }]));
  return { positions, bends };
}

export const positionsOf = (list: Node<StageNodeData>[]) =>
  new Map(list.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));

export function toLayout(
  positions: Map<string, GraphPoint>,
  bends: Map<string, GraphPoint>,
): PipelineLayout {
  return {
    nodes: [...positions].map(([key, p]) => ({ key, x: p.x, y: p.y })),
    arrows: [...bends].map(([id, b]) => {
      const [from, to] = id.split('->');
      return { from, to, x: b.x, y: b.y };
    }),
  };
}
