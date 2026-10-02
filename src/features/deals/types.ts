import type {
  DealRow,
  Id,
  PipelineLayout,
  PipelineStage,
  PipelineTransition,
} from '@crm/lib/backend';

export interface DealFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: DealRow;
  defaults?: {
    leadId?: Id<'leads'>;
    leadName?: string;
    pipelineId?: Id<'pipelines'>;
  };
  onCreated?: (dealId: Id<'deals'>) => void;
}

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

export interface StageNodeData extends Record<string, unknown> {
  stage: PipelineStage;
  warnings: string[];
  connectable: boolean;
}

export type GraphPoint = { x: number; y: number };

export interface GraphEditorHandlers {
  removeTransition: (from: string, to: string) => void;
  /** Session-only pull of an arrow's control point, in flow coordinates. */
  bendOf: (edgeId: string) => GraphPoint | undefined;
  setBend: (edgeId: string, bend: GraphPoint) => void;
  readOnly: boolean;
}

export type StageSkeleton = Pick<PipelineStage, 'key' | 'kind'>;

export type GraphMode = 'default' | 'full' | 'custom';
