import type { Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';

/** The dry run's verdict on a row, and the run's, one importer per entity. */
export type ImportVerdict =
  | { kind: 'error'; error: string }
  | { kind: 'create' }
  | { kind: 'update'; id: string; label: string }
  /** A record that looks like the row without sharing its key: the policy decides between update and create. */
  | { kind: 'duplicate'; id: string; label: string; reasons: string[] };

export type ImportApplied =
  | { kind: 'created'; id: string }
  | { kind: 'updated'; id: string }
  | { kind: 'error'; error: string };

export interface ImportActor {
  userId: Id<'users'>;
  listId?: Id<'leadLists'>;
}

/**
 * One entity's upsert in two halves that the run calls back to back on every row, so a dry run and the run it
 * precedes read the same rules: `plan` decides without writing, `apply` writes what was decided.
 */
export interface EntityImporter<Row, Caches, State> {
  loadCaches(ctx: MutationCtx): Promise<Caches>;
  plan(
    ctx: MutationCtx,
    row: Row,
    caches: Caches,
    opts: { matchId?: string; detectDuplicates: boolean },
  ): Promise<{ verdict: ImportVerdict; state: State }>;
  apply(
    ctx: MutationCtx,
    row: Row,
    state: State,
    caches: Caches,
    actor: ImportActor,
  ): Promise<ImportApplied>;
  /** Asked once per batch before anything is written, with the batch's row count. */
  gate?(ctx: MutationCtx, count: number): Promise<void>;
}
