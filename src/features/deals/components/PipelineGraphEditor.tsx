import { ReactFlowProvider } from '@xyflow/react';
import type { PipelineGraphEditorProps } from '../types';
import { PipelineGraphCanvas } from './PipelineGraphCanvas';

/** The pipeline's transition graph: one node per stage, one arrow per allowed move. */
export function PipelineGraphEditor(props: PipelineGraphEditorProps) {
  return (
    <ReactFlowProvider>
      <PipelineGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
