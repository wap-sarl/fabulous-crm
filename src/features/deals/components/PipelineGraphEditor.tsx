import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useInternalNode,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type IsValidConnection,
  type Node,
  type NodeProps,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TriangleAlert, X } from 'lucide-react';
import { Button, StatusBadge, cn, toast } from '@crm/design-system';
import {
  analyzePipelineGraph,
  effectiveTransitions,
  fullTransitions,
  isFullTransitions,
  validatePipelineTransitions,
} from '@crm/lib/backend';
import type {
  PipelineGraphIssue,
  PipelineLayout,
  PipelineStage,
  PipelineTransition,
} from '@crm/lib/backend';
import { DEAL_ERROR_MESSAGES } from '../lib/errors';

const NODE_W = 176;
const NODE_H = 58;
/** Sideways bend of an arrow so A → B and B → A don't overlap. */
const BEND = 26;
/** A drop counts anywhere on the node: the target anchor sits at the node's centre. */
const CONNECTION_RADIUS = Math.ceil(Math.hypot(NODE_W / 2, NODE_H / 2)) + 8;

export interface PipelineGraphEditorProps {
  stages: PipelineStage[];
  /** Undefined = the default graph (each stage → next and back). */
  transitions: PipelineTransition[] | undefined;
  onChange?: (transitions: PipelineTransition[] | undefined) => void;
  /** Saved placement: the preview shows it as-is, the editor starts from it. */
  layout?: PipelineLayout;
  /** Fired when the user moves a node or an arrow, or a relayout happens. */
  onLayoutChange?: (layout: PipelineLayout) => void;
  /** Preview: no toolbar, no editing. */
  readOnly?: boolean;
  /** Fill the parent's height instead of the fixed preview height. */
  fill?: boolean;
  className?: string;
}

interface StageNodeData extends Record<string, unknown> {
  stage: PipelineStage;
  warnings: string[];
  connectable: boolean;
}

type Point = { x: number; y: number };

interface EditorHandlers {
  removeTransition: (from: string, to: string) => void;
  /** Session-only pull of an arrow's control point, in flow coordinates. */
  bendOf: (edgeId: string) => Point | undefined;
  setBend: (edgeId: string, bend: Point) => void;
  readOnly: boolean;
}

const EditorContext = createContext<EditorHandlers>({
  removeTransition: () => undefined,
  bendOf: () => undefined,
  setBend: () => undefined,
  readOnly: true,
});

const edgeId = (t: PipelineTransition) => `${t.from}->${t.to}`;

type StageSkeleton = Pick<PipelineStage, 'key' | 'kind'>;

type GraphMode = 'default' | 'full' | 'custom';

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

function layoutStages(stages: StageSkeleton[], mode: GraphMode) {
  return mode === 'default' ? layoutColumn(stages) : layoutCircle(stages);
}

/** A saved layout usable for these stages (every stage placed), split into positions and pulls. */
function storedLayout(layout: PipelineLayout | undefined, stages: StageSkeleton[]) {
  if (!layout) return null;
  const positions = new Map(layout.nodes.map((n) => [n.key, { x: n.x, y: n.y }]));
  if (!stages.every((s) => positions.has(s.key))) return null;
  const bends = new Map(layout.arrows.map((a) => [`${a.from}->${a.to}`, { x: a.x, y: a.y }]));
  return { positions, bends };
}

const positionsOf = (list: Node<StageNodeData>[]) =>
  new Map(list.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));

function toLayout(positions: Map<string, Point>, bends: Map<string, Point>): PipelineLayout {
  return {
    nodes: [...positions].map(([key, p]) => ({ key, x: p.x, y: p.y })),
    arrows: [...bends].map(([id, b]) => {
      const [from, to] = id.split('->');
      return { from, to, x: b.x, y: b.y };
    }),
  };
}

function StageGraphNode({ data, selected }: NodeProps<Node<StageNodeData>>) {
  const { stage, warnings, connectable } = data;
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={cn(
        'relative flex flex-col justify-center gap-0.5 rounded-[10px] border bg-card px-3 py-2 shadow-card transition-all',
        stage.kind === 'won' && 'border-t-4 border-t-green-500',
        stage.kind === 'lost' && 'border-t-4 border-t-red-400',
        warnings.length > 0
          ? 'border-amber-400 ring-2 ring-amber-400/20'
          : selected
            ? 'border-primary ring-2 ring-primary/20'
            : undefined,
      )}
      title={warnings.join('\n') || undefined}
      data-testid={`pipeline-graph-node-${stage.key}`}
      data-warning={warnings.length > 0 ? 'true' : undefined}
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-bold text-ink">{stage.label}</span>
        {warnings.length > 0 ? (
          <TriangleAlert
            className="size-3.5 shrink-0 text-amber-500"
            aria-label={warnings.join(' ')}
          />
        ) : null}
      </div>
      {stage.kind !== 'open' ? (
        <StatusBadge tone={stage.kind === 'won' ? 'green' : 'red'}>
          {stage.kind === 'won' ? 'Gagnée' : 'Perdue'}
        </StatusBadge>
      ) : (
        <span className="text-[11px] text-faint">En cours</span>
      )}
      {/* Target anchor at the centre (never under the pointer): a drop anywhere on the node lands here. */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={connectable}
        className="!pointer-events-none !left-1/2 !top-1/2 !size-px !transform-none !border-0 !bg-transparent !opacity-0"
      />
      {/* Drag from the dot to another node to draw the arrow; drag the body to move the node. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={connectable}
        title="Tirez vers un autre stade pour autoriser la transition"
        className={cn(
          '!right-1.5 !top-auto !bottom-1.5 !z-10 !size-3.5 !transform-none !border-2 !border-card !bg-primary',
          connectable ? '!cursor-crosshair' : '!hidden',
        )}
      />
    </div>
  );
}

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
function TransitionEdge(props: EdgeProps<Edge>) {
  const { id, source, target, selected, markerEnd } = props;
  const { removeTransition, bendOf, setBend, readOnly } = useContext(EditorContext);
  const { getZoom } = useReactFlow();
  const drag = useRef<{ pointerId: number; startX: number; startY: number; base: Point } | null>(
    null,
  );
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
  const stroke = selected ? '#4F46E5' : '#9AA0AD';
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

const nodeTypes = { stage: StageGraphNode };
const edgeTypes = { transition: TransitionEdge };

export function describeGraphIssue(
  issue: PipelineGraphIssue,
  labelOf: (key: string) => string,
): string {
  switch (issue.kind) {
    case 'unreachable':
      return `« ${labelOf(issue.stageKey)} » est inaccessible : aucune flèche n'y mène depuis le premier stade.`;
    case 'dead_end':
      return `« ${labelOf(issue.stageKey)} » est une impasse : aucun chemin vers un stade gagnée ou perdue.`;
  }
}

function CanvasInner({
  stages,
  transitions,
  onChange,
  layout,
  onLayoutChange,
  readOnly = false,
  fill = false,
  className,
}: PipelineGraphEditorProps) {
  const { fitView } = useReactFlow();
  // Several graphs share the page (previews + editor): handles are looked up by flow id + node id.
  const flowId = useId();
  const editable = !readOnly && onChange !== undefined;
  const arrows = useMemo(
    () => effectiveTransitions({ stages, transitions }),
    [stages, transitions],
  );
  const isDefault = transitions === undefined;
  const isFull = useMemo(() => isFullTransitions(stages, transitions), [stages, transitions]);
  const mode: GraphMode = isDefault ? 'default' : isFull ? 'full' : 'custom';
  const labelOf = useCallback(
    (key: string) => stages.find((s) => s.key === key)?.label ?? key,
    [stages],
  );

  // The set / order of stages, independent of their labels.
  const signature = stages.map((s) => `${s.key}:${s.kind}`).join('|');
  const skeleton = useMemo<StageSkeleton[]>(
    () =>
      signature.split('|').map((part) => {
        const [key, kind] = part.split(':');
        return { key, kind: kind as PipelineStage['kind'] };
      }),
    [signature],
  );
  // Bumped by the toolbar buttons: the layout is redone then and on a stage change, never on an arrow edit.
  const [layoutRequest, setLayoutRequest] = useState(0);
  // The preview has no buttons: it follows the saved layout (or the mode when there is none).
  const layoutStamp = JSON.stringify(layout ?? null);
  const layoutKey = editable
    ? `${layoutRequest}|${signature}`
    : `${mode}|${signature}|${layoutStamp}`;

  const issues = useMemo(() => analyzePipelineGraph(stages, transitions), [stages, transitions]);

  // Nodes/edges live in React Flow state so it can stamp measurements and selection on them.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StageNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [bends, setBends] = useState<Map<string, Point>>(() => new Map());
  const laidOut = useRef<string | null>(null);
  const latest = useRef({ layout, nodes, bends, onLayoutChange });
  latest.current = { layout, nodes, bends, onLayoutChange };

  useEffect(() => {
    const relayout = laidOut.current !== layoutKey;
    const first = laidOut.current === null;
    laidOut.current = layoutKey;
    // The saved placement is the starting point (and the preview's only one); the buttons and
    // a stage change place the stages again.
    const stored =
      relayout && (first || !editable) ? storedLayout(latest.current.layout, skeleton) : null;
    const layout = relayout ? (stored?.positions ?? layoutStages(skeleton, mode)) : null;
    if (relayout) setBends(stored?.bends ?? new Map());
    if (relayout && !first && editable && layout) {
      latest.current.onLayoutChange?.(toLayout(layout, new Map()));
    }
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return stages.map((stage) => {
        const existing = byId.get(stage.key);
        return {
          ...existing,
          id: stage.key,
          type: 'stage',
          deletable: false,
          width: NODE_W,
          height: NODE_H,
          position: layout?.get(stage.key) ?? existing?.position ?? { x: 0, y: 0 },
          data: {
            stage,
            warnings: issues
              .filter((i) => i.stageKey === stage.key)
              .map((i) => describeGraphIssue(i, labelOf)),
            connectable: editable,
          },
        };
      });
    });
    if (!relayout) return;
    // Fit once React Flow has taken the new positions in (a frame is not always enough).
    const id = setTimeout(
      () => void fitView({ duration: editable ? 200 : 0, maxZoom: 1, padding: 0.15 }),
      80,
    );
    return () => clearTimeout(id);
  }, [stages, layoutKey, skeleton, mode, issues, labelOf, editable, setNodes, fitView]);

  useEffect(() => {
    setEdges((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]));
      return arrows.map((t) => {
        const id = edgeId(t);
        return {
          ...byId.get(id),
          id,
          source: t.from,
          target: t.to,
          type: 'transition',
          deletable: editable,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#9AA0AD' },
        };
      });
    });
  }, [arrows, editable, setEdges]);

  const removeTransition = useCallback(
    (from: string, to: string) => {
      onChange?.(arrows.filter((t) => !(t.from === from && t.to === to)));
    },
    [arrows, onChange],
  );

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      if (!connection.source || !connection.target) return false;
      const candidate = { from: connection.source, to: connection.target };
      return validatePipelineTransitions(stages, [...arrows, candidate]) === null;
    },
    [stages, arrows],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const next = [...arrows, { from: connection.source, to: connection.target }];
      const error = validatePipelineTransitions(stages, next);
      if (error) {
        toast.error(DEAL_ERROR_MESSAGES[error] ?? error);
        return;
      }
      onChange?.(next);
    },
    [stages, arrows, onChange],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const ids = new Set(deleted.map((e) => e.id));
      onChange?.(arrows.filter((t) => !ids.has(edgeId(t))));
    },
    [arrows, onChange],
  );

  const bendOf = useCallback((id: string) => bends.get(id), [bends]);
  const setBend = useCallback((id: string, bend: Point) => {
    const next = new Map(latest.current.bends).set(id, bend);
    setBends(next);
    latest.current.onLayoutChange?.(toLayout(positionsOf(latest.current.nodes), next));
  }, []);
  const onNodeDragStop = useCallback<OnNodeDrag<Node<StageNodeData>>>((_event, _node, dragged) => {
    const positions = positionsOf(latest.current.nodes);
    for (const n of dragged) positions.set(n.id, { x: n.position.x, y: n.position.y });
    latest.current.onLayoutChange?.(toLayout(positions, latest.current.bends));
  }, []);
  const handlers = useMemo<EditorHandlers>(
    () => ({ removeTransition, bendOf, setBend, readOnly: !editable }),
    [removeTransition, bendOf, setBend, editable],
  );

  return (
    <div className={cn('flex flex-col gap-3', fill && 'h-full min-h-0', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-faint">
          {editable
            ? 'Une flèche = une transition autorisée. Cliquez « × » sur une flèche (ou Suppr) pour l’interdire ; tirez depuis le point bleu d’un stade et relâchez sur un autre stade pour en ajouter une. Déplacez les stades, ou une flèche, en les faisant glisser.'
            : isDefault
              ? 'Transitions linéaires : chaque stade mène au suivant et peut revenir au précédent.'
              : isFull
                ? 'Toutes les transitions sont autorisées.'
                : 'Transitions personnalisées.'}
        </p>
        {editable ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange?.(fullTransitions(stages));
                setLayoutRequest((n) => n + 1);
              }}
              disabled={isFull}
              data-testid="pipeline-graph-allow-all"
            >
              Tout autoriser
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange?.(undefined);
                setLayoutRequest((n) => n + 1);
              }}
              disabled={isDefault}
              data-testid="pipeline-graph-linear"
            >
              Transitions linéaires
            </Button>
          </>
        ) : null}
      </div>
      <EditorContext.Provider value={handlers}>
        <div
          className={cn(
            'relative overflow-hidden rounded-xl border bg-canvas',
            fill ? 'min-h-0 flex-1' : 'h-64',
          )}
          data-testid="pipeline-graph"
          data-mode={mode}
        >
          <ReactFlow
            id={flowId}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Strict}
            connectionRadius={CONNECTION_RADIUS}
            nodesConnectable={editable}
            nodesDraggable={editable}
            elementsSelectable={editable}
            deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#D8DBE2" />
          </ReactFlow>
        </div>
      </EditorContext.Provider>
      {issues.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="pipeline-graph-issues">
          {issues.map((issue) => (
            <li
              key={`${issue.kind}:${issue.stageKey}`}
              className="flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
              data-testid="pipeline-graph-issue"
              data-kind={issue.kind}
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{describeGraphIssue(issue, labelOf)}</span>
            </li>
          ))}
        </ul>
      ) : editable ? (
        <p className="text-xs text-faint">
          Graphe cohérent : chaque stade est accessible et mène à une clôture.
        </p>
      ) : null}
    </div>
  );
}

/** The pipeline's transition graph: one node per stage, one arrow per allowed move. */
export function PipelineGraphEditor(props: PipelineGraphEditorProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
