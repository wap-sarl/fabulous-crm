import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { cn } from '@crm/design-system';
import type { InsertEdgeData } from '../lib/layout';
import { useCanvasHandlers } from './canvasContext';

/** An edge to a synthetic « + » node hides its insert button: the target itself is the affordance. */
export function InsertEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, target } = props;
  const data = props.data as InsertEdgeData | undefined;
  const { onInsert, readOnly } = useCanvasHandlers();

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const showInsert = !readOnly && data?.slot !== undefined && !target.startsWith('add:');
  const branchLabel = data?.branchLabel;

  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: '#C9CDD6', strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        {branchLabel ? (
          <span
            style={{
              // Anchored above the target: both edges leave the same point under the branch node, so the two pills would overlap there.
              transform: `translate(-50%, -50%) translate(${targetX}px, ${targetY - 24}px)`,
            }}
            className={cn(
              'absolute z-10 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide',
              branchLabel === 'Oui' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600',
            )}
          >
            {branchLabel}
          </span>
        ) : null}
        {showInsert ? (
          <button
            type="button"
            aria-label="Insérer une étape ici"
            data-testid="workflow-insert-edge"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="pointer-events-auto absolute z-10 flex size-5 cursor-pointer items-center justify-center rounded-full border bg-card text-faint opacity-70 shadow-card transition-all hover:scale-110 hover:border-primary hover:text-primary hover:opacity-100"
            onClick={() => onInsert(data!.slot)}
          >
            <Plus className="size-3" />
          </button>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}
