import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { TriangleAlert } from 'lucide-react';
import { StatusBadge, cn } from '@crm/design-system';
import { NODE_H, NODE_W } from '../lib/pipelineGraphLayout';
import type { StageNodeData } from '../types';

export function StageGraphNode({ data, selected }: NodeProps<Node<StageNodeData>>) {
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
