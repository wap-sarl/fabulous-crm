import { extensions } from '../extensions';
import type { MutationCtx } from '../_generated/server';
import { type RecordChange, refusalCode } from './extensionTypes';

// The observers of the extension seam: hooks the core tells, never asks (the gates are in gates.ts).

/** A failing hook leaves at most one audit row this often, so an import of thousands of rows cannot flood the table. */
const HOOK_FAILURE_TRACE_MS = 60 * 60 * 1000;
export const HOOK_FAILURE_ENTITY_ID = 'extensions:afterChange';

/** Mutations whose failure is already dealt with: a broken hook under a large import costs one read, not one per row. */
const traced = new WeakSet<object>();

/** Tells the overlay a record changed; an overlay bug must never cost the CRM its write, nor go unseen. */
export async function notifyChange(ctx: MutationCtx, change: RecordChange): Promise<void> {
  try {
    await extensions.afterChange(ctx, change);
  } catch (error) {
    const code = refusalCode(error);
    console.error('afterChange failed', change.type, code);
    if (traced.has(ctx)) return;
    traced.add(ctx);
    try {
      const last = await ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) =>
          q.eq('entityType', 'appConfig').eq('entityId', HOOK_FAILURE_ENTITY_ID),
        )
        .order('desc')
        .first();
      if (last && Date.now() - last.timestamp < HOOK_FAILURE_TRACE_MS) return;
      // Inserted directly: going through logAudit would call the failing hook again.
      await ctx.db.insert('auditLogs', {
        entityType: 'appConfig',
        entityId: HOOK_FAILURE_ENTITY_ID,
        action: 'update',
        timestamp: Date.now(),
        metadata: {
          event: 'afterChange_failed',
          code,
          change:
            change.type === 'audit'
              ? { type: 'audit', entityType: change.entityType, action: change.action }
              : { type: 'lifecycle' },
        },
      });
    } catch (traceError) {
      console.error('afterChange failure not traced', refusalCode(traceError));
    }
  }
}
