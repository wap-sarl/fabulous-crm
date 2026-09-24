import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import { internalMutation } from '../../_lib/functions';
import type { ImportCounts } from '../../_lib/validators/imports';
import { logAudit } from '../../lib/audit';
import { IMPORTERS } from './entities';

/** Rows deleted per call when a job is dropped. */
const DROP_PAGE = 500;

/**
 * One batch of a job, in the phase the job is in: the dry run records each row's verdict; the run applies it,
 * drops the rows it wrote (their content is in the CRM now) and keeps the rows in error for the report. A batch
 * that throws is rolled back whole and the job stays at that batch; the action wrapper marks it interrupted.
 */
export const runBatch = internalMutation({
  args: { jobId: v.id('importJobs'), batch: v.number() },
  returns: v.object({ more: v.boolean() }),
  handler: async (ctx, { jobId, batch }) => {
    const job = await ctx.db.get(jobId);
    // A cancelled job, or a batch scheduled twice: nothing to do.
    if (
      !job ||
      (job.status !== 'simulating' && job.status !== 'running') ||
      job.nextBatch !== batch
    ) {
      return { more: false };
    }
    const running = job.status === 'running';
    const from = batch * job.batchSize;
    const to = Math.min(from + job.batchSize, job.totalRows);
    const rows = await ctx.db
      .query('importRows')
      .withIndex('by_job_index', (q) => q.eq('jobId', jobId).gte('index', from).lt('index', to))
      .collect();
    const importer = IMPORTERS[job.entity];
    const caches = await importer.loadCaches(ctx);
    const counts: ImportCounts = { ...job.counts };
    const actor = { userId: job.createdBy, listId: job.listId };
    const pending = rows.filter((row) => row.data !== undefined);
    // Every row counts, the invalid ones included: no matching pass before the gate, by decision.
    if (running && importer.gate) await importer.gate(ctx, rows.length);
    for (const row of pending) {
      // The dry run's duplicate becomes an update of that record under the policy, a creation otherwise.
      const matchId =
        running && row.outcome === 'duplicate' && job.duplicatePolicy === 'update'
          ? row.matchId
          : undefined;
      const { verdict, state } = await importer.plan(ctx, row.data, caches, {
        matchId,
        detectDuplicates: !running && job.entity === 'lead',
      });
      if (!running) {
        counts[verdictKey(verdict.kind)] += 1;
        await ctx.db.patch(row._id, {
          outcome: verdict.kind,
          error: verdict.kind === 'error' ? verdict.error : undefined,
          matchId:
            verdict.kind === 'update' || verdict.kind === 'duplicate' ? verdict.id : undefined,
          matchLabel:
            verdict.kind === 'update' || verdict.kind === 'duplicate' ? verdict.label : undefined,
          reasons: verdict.kind === 'duplicate' ? verdict.reasons : undefined,
        });
        continue;
      }
      const applied =
        verdict.kind === 'error'
          ? verdict
          : await importer.apply(ctx, row.data, state, caches, actor);
      if (applied.kind === 'error') {
        counts.errors += 1;
        await ctx.db.patch(row._id, { outcome: 'error', error: applied.error, matchId: undefined });
        continue;
      }
      counts[applied.kind] += 1;
      await ctx.db.delete(row._id);
    }
    const last = to >= job.totalRows;
    const now = Date.now();
    if (!last) {
      await ctx.db.patch(jobId, { counts, nextBatch: batch + 1, updatedAt: now });
      return { more: true };
    }
    if (!running) {
      await ctx.db.patch(jobId, {
        counts,
        nextBatch: batch + 1,
        status: 'simulated',
        updatedAt: now,
      });
      return { more: false };
    }
    await ctx.db.patch(jobId, {
      counts,
      nextBatch: batch + 1,
      status: 'done',
      finishedAt: now,
      updatedAt: now,
    });
    await logAudit({
      ctx,
      userId: job.createdBy,
      entityType: 'importJob',
      entityId: jobId,
      action: 'create',
      metadata: { entity: job.entity, fileName: job.fileName, counts },
    });
    return { more: false };
  },
});

const verdictKey = (kind: 'error' | 'create' | 'update' | 'duplicate'): keyof ImportCounts =>
  kind === 'error'
    ? 'errors'
    : kind === 'create'
      ? 'created'
      : kind === 'update'
        ? 'updated'
        : 'duplicates';

/** A batch threw: the job waits at that batch for a resume, with the error on show. */
export const markInterrupted = internalMutation({
  args: { jobId: v.id('importJobs'), batch: v.number(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId, batch, error }) => {
    const job = await ctx.db.get(jobId);
    if (
      !job ||
      (job.status !== 'simulating' && job.status !== 'running') ||
      job.nextBatch !== batch
    ) {
      return null;
    }
    await ctx.db.patch(jobId, {
      status: 'interrupted',
      interruptedFrom: job.status,
      error: error.slice(0, 500),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Delete a job's rows a page at a time, then the job itself when asked. */
export const dropRows = internalMutation({
  args: { jobId: v.id('importJobs'), thenJob: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { jobId, thenJob }) => {
    const rows: Doc<'importRows'>[] = await ctx.db
      .query('importRows')
      .withIndex('by_job_index', (q) => q.eq('jobId', jobId))
      .take(DROP_PAGE);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === DROP_PAGE) {
      await ctx.scheduler.runAfter(0, internal.features.imports.internal.dropRows, {
        jobId,
        thenJob,
      });
      return null;
    }
    if (thenJob && (await ctx.db.get(jobId))) await ctx.db.delete(jobId);
    return null;
  },
});
