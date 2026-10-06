import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@crm/design-system';
import { countActiveRules } from '../../filters/lib/advancedFilter';
import type { WorkflowDraft } from '../types';
import { layoutWorkflow, type AddNodeData } from '../lib/layout';
import { CanvasContext, CanvasSelectionContext, type CanvasHandlers } from './canvasContext';
import { TriggerNode, StepNode, AddNode } from './WorkflowNodes';
import { InsertEdge } from './WorkflowEdges';

const nodeTypes = { trigger: TriggerNode, step: StepNode, add: AddNode };
const edgeTypes = { insert: InsertEdge };

export interface WorkflowCanvasProps {
  draft: WorkflowDraft;
  invalidIds?: Set<string>;
  selectedId: string | 'trigger' | null;
  handlers: CanvasHandlers;
  className?: string;
}

function CanvasInner({ draft, invalidIds, selectedId, handlers }: WorkflowCanvasProps) {
  const { fitView } = useReactFlow();

  // Laid out from what the graph is made of, not from the whole draft: typing the name leaves the nodes and the edges as they are.
  const { nodes: steps, startNodeId, trigger, enrollmentCriteria } = draft;
  const { nodes, edges } = useMemo(
    () =>
      layoutWorkflow(
        { nodes: steps, startNodeId, trigger },
        { invalidIds, criteriaCount: countActiveRules(enrollmentCriteria) },
      ),
    [steps, startNodeId, trigger, enrollmentCriteria, invalidIds],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the node count is the trigger, the graph is framed again when it grows or shrinks, not on a config edit
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void fitView({ duration: 200, maxZoom: 1, padding: 0.2 });
    });
    return () => cancelAnimationFrame(id);
  }, [nodes.length, fitView]);

  // Load-bearing: with nodesDraggable and elementsSelectable off, React Flow only gives node wrappers pointer events when an onNodeClick is registered.
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'trigger') handlers.onSelect('trigger');
      else if (node.type === 'step') handlers.onSelect(node.id);
      else if (node.type === 'add' && !handlers.readOnly) {
        handlers.onInsert((node.data as AddNodeData).slot);
      }
    },
    [handlers],
  );

  return (
    <CanvasContext.Provider value={handlers}>
      <CanvasSelectionContext.Provider value={selectedId}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.5}
            color="var(--border-strong)"
          />
        </ReactFlow>
      </CanvasSelectionContext.Provider>
    </CanvasContext.Provider>
  );
}
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl border bg-canvas', props.className)}>
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
