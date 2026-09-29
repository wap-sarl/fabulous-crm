import type { MutationCtx } from '../../../_generated/server';
import type { LeadImportActor } from '../../../lib/leads/import';

/** The dry run's verdict on a row, and the run's, one importer per entity. */
type ImportVerdict =
  | { kind: 'error'; error: string }
  | { kind: 'create' }
  | { kind: 'update'; id: string; label: string }
  /** A record that looks like the row without sharing its key: the policy decides between update and create. */
  | { kind: 'duplicate'; id: string; label: string; reasons: string[] };

type ImportApplied =
  | { kind: 'created'; id: string }
  | { kind: 'updated'; id: string }
  | { kind: 'error'; error: string };

type ImportActor = LeadImportActor;

/** `plan` decides without writing and `apply` writes what was decided, so a dry run and the run it precedes read the same rules. */
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
