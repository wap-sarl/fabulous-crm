import { useContext, useRef } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { X } from 'lucide-react';
import { cn } from '@crm/design-system';
import { EditorContext } from '../lib/pipelineGraphContext';
import { NODE_H, NODE_W } from '../lib/pipelineGraphLayout';
import type { GraphPoint } from '../types';

/** Sideways bend of an arrow so A → B and B → A don't overlap. */
const BEND = 26;

function center(node: InternalNode): { x: number; y: number; hw: number; hh: number } {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured?.width ?? node.width ?? NODE_W;
  const h = node.measured?.height ?? node.height ?? NODE_H;
  return { x: x + w / 2, y: y + h / 2, hw: w / 2, hh: h / 2 };
}

/** Where a ray from a node's center in direction (dx, dy) leaves its border. */
function borderPoint(c: ReturnType<typeof center>, dx: number, dy: number) {
  const t = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : Math.abs(c.hw / dx),
    dy === 0 ? Number.POSITIVE_INFINITY : Math.abs(c.hh / dy),
  );
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Floating arrow between node borders, bent to its own right; « × » sits at its midpoint; drag it to re-bend. */
export function TransitionEdge(props: EdgeProps<Edge>) {
  const { id, source, target, selected, markerEnd } = props;
  const { removeTransition, bendOf, setBend, readOnly } = useContext(EditorContext);
  const { getZoom } = useReactFlow();
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    base: GraphPoint;
  } | null>(null);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const cs = center(sourceNode);
  const ct = center(targetNode);
  const dx = ct.x - cs.x;
  const dy = ct.y - cs.y;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal to the right of the travel direction (screen coordinates, y down).
  const nx = dy / len;
  const ny = -dx / len;
  // Aligned stages with one in between (column layout): bend wide enough to clear it.
  const aligned = Math.abs(dx) < NODE_W || Math.abs(dy) < NODE_H;
  const bend = aligned && len > (NODE_H + 64) * 1.5 ? NODE_W * 0.6 : BEND;
  const pull = bendOf(id) ?? { x: 0, y: 0 };
  const start = borderPoint(cs, dx + nx * bend + pull.x, dy + ny * bend + pull.y);
  const end = borderPoint(ct, -dx + nx * bend + pull.x, -dy + ny * bend + pull.y);
  const control = {
    x: (start.x + end.x) / 2 + nx * 2 * bend + 2 * pull.x,
    y: (start.y + end.y) / 2 + ny * 2 * bend + 2 * pull.y,
  };
  const path = `M ${start.x},${start.y} Q ${control.x},${control.y} ${end.x},${end.y}`;
  // Midpoint of a quadratic curve: halfway between the chord's middle and the control point.
  const labelX = (start.x + end.x) / 2 + nx * bend + pull.x;
  const labelY = (start.y + end.y) / 2 + ny * bend + pull.y;
  const stroke = selected ? 'var(--primary)' : 'var(--faint)';
  const onPointerDown = (e: React.PointerEvent<SVGPathElement>) => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, base: pull };
  };
  const onPointerMove = (e: React.PointerEvent<SVGPathElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const zoom = getZoom();
    setBend(id, {
      x: d.base.x + (e.clientX - d.startX) / zoom,
      y: d.base.y + (e.clientY - d.startY) / zoom,
    });
  };
  const onPointerUp = (e: React.PointerEvent<SVGPathElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke, strokeWidth: selected ? 2.5 : 1.75 }}
      />
      {!readOnly ? (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          className="nopan nodrag cursor-grab active:cursor-grabbing"
          style={{ pointerEvents: 'stroke' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid={`pipeline-graph-arrow-${source}-${target}`}
        />
      ) : null}
      {!readOnly ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label={`Supprimer la transition ${source} → ${target}`}
            data-testid={`pipeline-graph-edge-${source}-${target}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              'pointer-events-auto absolute z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border bg-card text-faint shadow-card transition-colors hover:border-destructive hover:text-destructive',
              selected ? 'opacity-100' : 'opacity-70 hover:opacity-100',
            )}
            onClick={(e) => {
              e.stopPropagation();
              removeTransition(source, target);
            }}
          >
            <X className="size-2.5" />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
