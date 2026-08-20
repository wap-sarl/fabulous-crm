import { createContext, useContext } from 'react';
import type { InsertSlot } from '../types';

/**
 * Callbacks and label context the canvas nodes/edges need. Passed via React
 * context instead of node `data` so layout stays pure and serializable.
 */
export interface CanvasHandlers {
  selectedId: string | 'trigger' | null;
  onSelect: (id: string | 'trigger') => void;
  onInsert: (slot: InsertSlot) => void;
  onRemove: (id: string) => void;
  listNameById: Map<string, string>;
  definitionLabelById: Map<string, string>;
  readOnly?: boolean;
}

export const CanvasContext = createContext<CanvasHandlers | null>(null);

export function useCanvasHandlers(): CanvasHandlers {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error('CanvasContext manquant');
  return ctx;
}
