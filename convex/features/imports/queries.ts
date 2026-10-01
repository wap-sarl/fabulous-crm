import { paginationResultValidator } from 'convex/server';
import { docOf } from '../../lib/shared/docs';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';
import {
  IMPORT_ERROR_EXPORT_CAP,
  importEntityValidator,
  importRowOutcomeValidator,
} from '../../_lib/validators/imports';
import { loadOwnJob, requireImportAccess } from './lib';

/** The saved mappings of an entity, for the picker; the newest first. */
export const listMappings = employeeQuery({
  args: { entity: importEntityValidator },
  returns: v.array(
    v.object({
      _id: v.id('importMappings'),
      name: v.string(),
      headers: v.array(v.string()),
      targets: v.array(v.union(v.string(), v.null())),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { entity }) => {
    requireImportAccess(ctx.visibility, entity);
    const rows = await ctx.db
      .query('importMappings')
      .withIndex('by_entity', (q) => q.eq('entity', entity))
      .collect();
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ _id, name, headers, targets, updatedAt }) => ({
        _id,
        name,
        headers,
        targets,
        updatedAt,
      }));
  },
});

/** The caller's jobs, the most recent first; every job for a settings holder. */
export const listJobs = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('importJobs'),
      _creationTime: v.number(),
      entity: importEntityValidator,
      fileName: v.string(),
      status: v.union(
        v.literal('running'),
        v.literal('done'),
        v.literal('cancelled'),
        v.literal('uploading'),
        v.literal('simulating'),
        v.literal('simulated'),
        v.literal('interrupted'),
      ),
      totalRows: v.number(),
      counts: v.object({
        created: v.number(),
        updated: v.number(),
        duplicates: v.number(),
        errors: v.number(),
      }),
      finishedAt: v.union(v.number(), v.null()),
      createdByName: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const rows = ctx.visibility.access.settings
      ? await ctx.db.query('importJobs').order('desc').take(50)
      : await ctx.db
          .query('importJobs')
          .withIndex('by_createdBy_updatedAt', (q) => q.eq('createdBy', ctx.userId))
          .order('desc')
          .take(50);
    const out = [];
    for (const job of rows) {
      const by = await ctx.db.get(job.createdBy);
      out.push({
        _id: job._id,
        _creationTime: job._creationTime,
        entity: job.entity,
        fileName: job.fileName,
        status: job.status,
        totalRows: job.totalRows,
        counts: job.counts,
        finishedAt: job.finishedAt ?? null,
        createdByName: by ? `${by.firstName} ${by.lastName}` : null,
      });
    }
    return out;
  },
});

/** One job with its progress; the page subscribes to it while batches run. */
export const getJob = employeeQuery({
  args: { jobId: v.id('importJobs') },
  returns: v.object({
    ...docOf('importJobs').fields,
    listName: v.union(v.string(), v.null()),
    mappingName: v.union(v.string(), v.null()),
    progress: v.number(),
  }),
  handler: async (ctx, { jobId }) => {
    const job = await loadOwnJob(ctx, jobId);
    const list = job.listId ? await ctx.db.get(job.listId) : null;
    const mapping = job.mappingId ? await ctx.db.get(job.mappingId) : null;
    return {
      ...job,
      listName: list?.name ?? null,
      mappingName: mapping?.name ?? null,
      // Batches done over batches to do, whatever the phase.
      progress: Math.min(1, (job.nextBatch * job.batchSize) / Math.max(1, job.totalRows)),
    };
  },
});

/** A job's rows of one outcome, in file order: the duplicates to decide on, the errors to review. */
export const listJobRows = employeeQuery({
  args: {
    jobId: v.id('importJobs'),
    outcome: importRowOutcomeValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      _id: v.id('importRows'),
      index: v.number(),
      line: v.number(),
      raw: v.array(v.string()),
      error: v.union(v.string(), v.null()),
      matchId: v.union(v.string(), v.null()),
      matchLabel: v.union(v.string(), v.null()),
      reasons: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { jobId, outcome, paginationOpts }) => {
    await loadOwnJob(ctx, jobId);
    const page = await ctx.db
      .query('importRows')
      .withIndex('by_job_outcome_index', (q) => q.eq('jobId', jobId).eq('outcome', outcome))
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map(({ _id, index, line, raw, error, matchId, matchLabel, reasons }) => ({
        _id,
        index,
        line,
        raw,
        error: error ?? null,
        matchId: matchId ?? null,
        matchLabel: matchLabel ?? null,
        reasons: reasons ?? [],
      })),
    };
  },
});

/** The rows in error with their source cells, for the error file the report offers. */
export const errorRows = employeeQuery({
  args: { jobId: v.id('importJobs') },
  returns: v.object({
    headers: v.array(v.string()),
    rows: v.array(v.object({ line: v.number(), raw: v.array(v.string()), error: v.string() })),
    capped: v.boolean(),
  }),
  handler: async (ctx, { jobId }) => {
    const job = await loadOwnJob(ctx, jobId);
    const rows = await ctx.db
      .query('importRows')
      .withIndex('by_job_outcome_index', (q) => q.eq('jobId', jobId).eq('outcome', 'error'))
      .take(IMPORT_ERROR_EXPORT_CAP);
    return {
      headers: job.headers,
      rows: rows.map((r) => ({ line: r.line, raw: r.raw, error: r.error ?? 'invalid_row' })),
      capped: rows.length === IMPORT_ERROR_EXPORT_CAP,
    };
  },
});
