import { createContext } from 'react';
import type { GraphEditorHandlers } from '../types';

export const EditorContext = createContext<GraphEditorHandlers>({
  removeTransition: () => undefined,
  bendOf: () => undefined,
  setBend: () => undefined,
  readOnly: true,
});
