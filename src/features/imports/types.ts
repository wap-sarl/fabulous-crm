import type { api } from '@crm/lib/backend';
import type { FunctionReturnType } from 'convex/server';

/** A saved mapping as the list of mappings gives it. */
export type ImportMappingRow = FunctionReturnType<
  typeof api.features.imports.queries.listMappings
>[number];

/** An import as the list of recent imports gives it. */
export type ImportJobRow = FunctionReturnType<typeof api.features.imports.queries.listJobs>[number];

/** Where imported leads go: a list made for them, one that exists, or none. */
export type ListMode = 'new' | 'existing' | 'none';

/** The rows sent so far, while the file goes up in chunks. */
export interface UploadProgress {
  done: number;
  total: number;
}
