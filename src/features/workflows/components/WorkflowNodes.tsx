import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Plus, TriangleAlert, Trash2, Zap } from 'lucide-react';
import { cn } from '@crm/design-system';
import { countActiveRules } from '../../leads/lib/advancedFilter';
import { nodeSummary, STEP_TYPE_META, triggerLabel } from '../lib/constants';
import { NODE_W, NODE_H, ADD_SIZE } from '../lib/layout';
import type { AddNodeData, StepNodeData, TriggerNodeData } from '../lib/layout';
import { useCanvasHandlers } from './canvasContext';

/** Invisible connection points — edges are engine-drawn, never user-made. */
function HiddenHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!pointer-events-none !opacity-0" />
    </>
  );
}

const cardClass = (selected: boolean, invalid: boolean) =>
  cn(
    'flex cursor-pointer flex-col justify-center gap-1 rounded-[10px] border bg-card px-4 py-3 text-left shadow-card transition-all hover:shadow-card-hover',
    selected ? 'border-primary ring-2 ring-primary/20' : 'hover:border-[#DADDE4]',
    invalid && !selected && 'border-amber-400'
  );

export function TriggerNode({ data }: NodeProps) {
  const { trigger, criteriaCount } = data as unknown as TriggerNodeData;
  const { selectedId } = useCanvasHandlers();
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={cn(cardClass(selectedId === 'trigger', trigger === null), 'border-t-4 border-t-primary')}
      data-testid="workflow-trigger-node"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <Zap className="size-3.5" />
        Déclencheur
      </div>
      <div className="truncate text-[14px] font-bold text-ink">
        {trigger ? triggerLabel(trigger) : 'Choisir un événement'}
      </div>
      <div className="truncate text-[12px] text-faint">
        {criteriaCount > 0
          ? `${criteriaCount} critère(s) d'inscription`
          : "Aucun critère d'inscription"}
      </div>
      <HiddenHandles />
    </div>
  );
}

export function StepNode({ data }: NodeProps) {
  const { node, invalid } = data as unknown as StepNodeData;
  const handlers = useCanvasHandlers();
  const meta = STEP_TYPE_META.get(node.type);
  const Icon = meta?.icon;
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={cn(cardClass(handlers.selectedId === node.id, invalid), 'group')}
      data-testid="workflow-step-node"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-3.5" />
            </span>
          ) : null}
          <span className="truncate text-[13.5px] font-bold text-ink">{meta?.label ?? node.type}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {invalid ? <TriangleAlert className="size-4 text-amber-500" /> : null}
          {!handlers.readOnly ? (
            <button
              type="button"
              aria-label="Supprimer l'étape"
              className="cursor-pointer rounded p-1 text-faint opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handlers.onRemove(node.id);
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="truncate pl-8 text-[12px] text-faint">
        {node.type === 'branch'
          ? `${countActiveRules(node.condition)} condition(s) active(s)`
          : nodeSummary(node, handlers)}
      </div>
      <HiddenHandles />
    </div>
  );
}

export function AddNode({ data }: NodeProps) {
  const { slot } = data as unknown as AddNodeData;
  const { onInsert, readOnly } = useCanvasHandlers();
  if (readOnly) {
    return (
      <div style={{ width: ADD_SIZE, height: ADD_SIZE }} className="opacity-0">
        <HiddenHandles />
      </div>
    );
  }
  return (
    <button
      type="button"
      style={{ width: ADD_SIZE, height: ADD_SIZE }}
      aria-label="Ajouter une étape"
      data-testid="workflow-add-node"
      className="flex cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-[#C9CDD6] bg-canvas text-faint transition-colors hover:border-primary hover:text-primary"
      onClick={() => onInsert(slot)}
    >
      <Plus className="size-4" />
      <HiddenHandles />
    </button>
  );
}
