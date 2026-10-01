import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TriangleAlert } from 'lucide-react';
import { Button, cn, toast } from '@crm/design-system';
import {
  analyzePipelineGraph,
  effectiveTransitions,
  fullTransitions,
  isFullTransitions,
  validatePipelineTransitions,
} from '@crm/lib/backend';
import type { PipelineGraphIssue, PipelineStage, PipelineTransition } from '@crm/lib/backend';
import { DEAL_ERROR_MESSAGES } from '../lib/errors';
import { EditorContext } from '../lib/pipelineGraphContext';
import {
  NODE_H,
  NODE_W,
  layoutStages,
  positionsOf,
  storedLayout,
  toLayout,
} from '../lib/pipelineGraphLayout';
import type {
  GraphEditorHandlers,
  GraphMode,
  PipelineGraphEditorProps,
  GraphPoint,
  StageNodeData,
  StageSkeleton,
} from '../types';
import { StageGraphNode } from './StageGraphNode';
import { TransitionEdge } from './TransitionEdge';

/** A drop counts anywhere on the node: the target anchor sits at the node's centre. */
const CONNECTION_RADIUS = Math.ceil(Math.hypot(NODE_W / 2, NODE_H / 2)) + 8;

const edgeId = (t: PipelineTransition) => `${t.from}->${t.to}`;

const nodeTypes = { stage: StageGraphNode };
const edgeTypes = { transition: TransitionEdge };

function describeGraphIssue(issue: PipelineGraphIssue, labelOf: (key: string) => string): string {
  switch (issue.kind) {
    case 'unreachable':
      return `« ${labelOf(issue.stageKey)} » est inaccessible : aucune flèche n'y mène depuis le premier stade.`;
    case 'dead_end':
      return `« ${labelOf(issue.stageKey)} » est une impasse : aucun chemin vers un stade gagnée ou perdue.`;
  }
}

export function PipelineGraphCanvas({
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
  const [bends, setBends] = useState<Map<string, GraphPoint>>(() => new Map());
  const laidOut = useRef<string | null>(null);
  const latest = useRef({ layout, nodes, bends, onLayoutChange });
  latest.current = { layout, nodes, bends, onLayoutChange };

  useEffect(() => {
    const relayout = laidOut.current !== layoutKey;
    const first = laidOut.current === null;
    laidOut.current = layoutKey;
    // The saved placement is the starting point (and the preview's only one); the buttons and a stage change place the stages again.
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
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--faint)' },
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
  const setBend = useCallback((id: string, bend: GraphPoint) => {
    const next = new Map(latest.current.bends).set(id, bend);
    setBends(next);
    latest.current.onLayoutChange?.(toLayout(positionsOf(latest.current.nodes), next));
  }, []);
  const onNodeDragStop = useCallback<OnNodeDrag<Node<StageNodeData>>>((_event, _node, dragged) => {
    const positions = positionsOf(latest.current.nodes);
    for (const n of dragged) positions.set(n.id, { x: n.position.x, y: n.position.y });
    latest.current.onLayoutChange?.(toLayout(positions, latest.current.bends));
  }, []);
  const handlers = useMemo<GraphEditorHandlers>(
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
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.5}
              color="var(--border-strong)"
            />
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
