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
import { countActiveRules } from '../../leads/lib/advancedFilter';
import type { WorkflowDraft } from '../types';
import { layoutWorkflow, type AddNodeData } from '../lib/layout';
import { CanvasContext, type CanvasHandlers } from './canvasContext';
import { TriggerNode, StepNode, AddNode } from './WorkflowNodes';
import { InsertEdge } from './WorkflowEdges';

const nodeTypes = { trigger: TriggerNode, step: StepNode, add: AddNode };
const edgeTypes = { insert: InsertEdge };

export interface WorkflowCanvasProps {
  draft: WorkflowDraft;
  invalidIds?: Set<string>;
  handlers: CanvasHandlers;
  className?: string;
}

function CanvasInner({ draft, invalidIds, handlers }: WorkflowCanvasProps) {
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(
    () =>
      layoutWorkflow(draft, {
        invalidIds,
        criteriaCount: countActiveRules(draft.enrollmentCriteria),
      }),
    [draft, invalidIds],
  );

  // Re-frame when the graph grows/shrinks (not on config-only edits).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void fitView({ duration: 200, maxZoom: 1, padding: 0.2 });
    });
    return () => cancelAnimationFrame(id);
  }, [nodes.length, fitView]);

  // Single click dispatcher. Also load-bearing: with nodesDraggable and
  // elementsSelectable off, React Flow only gives node wrappers pointer
  // events when an onNodeClick handler is registered.
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
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#D8DBE2" />
      </ReactFlow>
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
