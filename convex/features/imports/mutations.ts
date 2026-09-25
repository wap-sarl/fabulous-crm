import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { employeeMutation } from '../../_lib/auth';
import {
  emptyImportCounts,
  IMPORT_BATCH_SIZE,
  IMPORT_MAX_ROWS,
  importEntityValidator,
  importRowDataValidator,
} from '../../_lib/validators/imports';
import { loadOwnJob, requireImportAccess } from './lib';

const targetsValidator = v.array(v.union(v.string(), v.null()));

/** Save a column mapping for a source, or rename and update one; the name is what the picker shows. */
export const saveMapping = employeeMutation({
  args: {
    mappingId: v.optional(v.id('importMappings')),
    entity: importEntityValidator,
    name: v.string(),
    headers: v.array(v.string()),
    targets: targetsValidator,
  },
  returns: v.id('importMappings'),
  handler: async (ctx, args) => {
    requireImportAccess(ctx.visibility, args.entity);
    const name = args.name.trim();
    if (!name) throw new Error('mapping_name_required');
    if (args.headers.length !== args.targets.length) throw new Error('mapping_mismatch');
    const now = Date.now();
    if (args.mappingId) {
      const mapping = await ctx.db.get(args.mappingId);
      if (!mapping || mapping.entity !== args.entity) throw new Error('mapping_not_found');
      await ctx.db.patch(args.mappingId, {
        name,
        headers: args.headers,
        targets: args.targets,
        updatedAt: now,
        updatedBy: ctx.userId,
      });
      return args.mappingId;
    }
    return await ctx.db.insert('importMappings', {
      entity: args.entity,
      name,
      headers: args.headers,
      targets: args.targets,
      updatedAt: now,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
  },
});

export const deleteMapping = employeeMutation({
  args: { mappingId: v.id('importMappings') },
  returns: v.null(),
  handler: async (ctx, { mappingId }) => {
    const mapping = await ctx.db.get(mappingId);
    if (!mapping) return null;
    requireImportAccess(ctx.visibility, mapping.entity);
    await ctx.db.delete(mappingId);
    return null;
  },
});

/** Open a job for a file; the rows follow in chunks, then the dry run. */
export const createJob = employeeMutation({
  args: {
    entity: importEntityValidator,
    fileName: v.string(),
    headers: v.array(v.string()),
    targets: targetsValidator,
    mappingId: v.optional(v.id('importMappings')),
    listId: v.optional(v.id('leadLists')),
    totalRows: v.number(),
  },
  returns: v.id('importJobs'),
  handler: async (ctx, args) => {
    requireImportAccess(ctx.visibility, args.entity);
    if (args.headers.length !== args.targets.length) throw new Error('mapping_mismatch');
    if (!Number.isInteger(args.totalRows) || args.totalRows < 1) throw new Error('import_empty');
    if (args.totalRows > IMPORT_MAX_ROWS) throw new Error('import_too_large');
    if (args.listId) {
      if (args.entity !== 'lead') throw new Error('list_for_leads_only');
      const list = await ctx.db.get(args.listId);
      if (!list) throw new Error('list_not_found');
      if (list.kind === 'dynamic') throw new Error('list_is_dynamic');
    }
    return await ctx.db.insert('importJobs', {
      entity: args.entity,
      fileName: args.fileName.trim() || 'import',
      status: 'uploading',
      headers: args.headers,
      targets: args.targets,
      mappingId: args.mappingId,
      listId: args.listId,
      totalRows: args.totalRows,
      uploadedRows: 0,
      invalidRows: 0,
      batchSize: IMPORT_BATCH_SIZE,
      nextBatch: 0,
      counts: emptyImportCounts(),
      updatedAt: Date.now(),
      createdBy: ctx.userId,
    });
  },
});

/**
 * One chunk of rows, the next in file order: a chunk sent twice or out of order is refused, so a row exists once
 * and the row count is the announced one. A row the SPA could not build comes with its error and no data.
 */
export const appendRows = employeeMutation({
  args: {
    jobId: v.id('importJobs'),
    rows: v.array(
      v.object({
        index: v.number(),
        line: v.number(),
        raw: v.array(v.string()),
        data: v.optional(importRowDataValidator),
        error: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, rows }) => {
    const job = await loadOwnJob(ctx, jobId);
    if (job.status !== 'uploading') throw new Error('import_not_uploading');
    if (rows.length === 0) return null;
    if (job.uploadedRows + rows.length > job.totalRows) throw new Error('import_row_out_of_range');
    let errors = 0;
    for (const [i, row] of rows.entries()) {
      if (row.index !== job.uploadedRows + i) throw new Error('import_chunk_out_of_order');
      const invalid = row.data === undefined;
      if (invalid) errors += 1;
      await ctx.db.insert('importRows', {
        jobId,
        index: row.index,
        line: row.line,
        raw: row.raw,
        data: row.data,
        outcome: invalid ? 'error' : undefined,
        error: invalid ? (row.error ?? 'invalid_row') : undefined,
      });
    }
    await ctx.db.patch(jobId, {
      uploadedRows: job.uploadedRows + rows.length,
      invalidRows: job.invalidRows + errors,
      counts: { ...job.counts, errors: job.counts.errors + errors },
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** The dry run: every row gets its verdict, nothing is written to the CRM. */
export const simulateJob = employeeMutation({
  args: { jobId: v.id('importJobs') },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await loadOwnJob(ctx, jobId);
    if (job.status !== 'uploading') throw new Error('import_not_uploading');
    if (job.uploadedRows !== job.totalRows) throw new Error('import_incomplete');
    await ctx.db.patch(jobId, {
      status: 'simulating',
      nextBatch: 0,
      // The rows the SPA could not build stay in error; the rest is decided batch by batch.
      counts: { ...emptyImportCounts(), errors: job.invalidRows },
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.features.imports.actions.runBatch, {
      jobId,
      batch: 0,
    });
    return null;
  },
});

/** The run, after a dry run; `duplicatePolicy` settles the rows the dry run flagged as probable duplicates. */
export const launchJob = employeeMutation({
  args: {
    jobId: v.id('importJobs'),
    duplicatePolicy: v.optional(v.union(v.literal('update'), v.literal('create'))),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, duplicatePolicy }) => {
    const job = await loadOwnJob(ctx, jobId);
    if (job.status !== 'simulated') throw new Error('import_not_simulated');
    if (job.counts.duplicates > 0 && !duplicatePolicy) throw new Error('duplicate_policy_required');
    await ctx.db.patch(jobId, {
      status: 'running',
      duplicatePolicy,
      nextBatch: 0,
      simulated: job.counts,
      counts: { ...emptyImportCounts(), errors: job.invalidRows },
      startedAt: Date.now(),
      finishedAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.features.imports.actions.runBatch, {
      jobId,
      batch: 0,
    });
    return null;
  },
});

/** Take an interrupted job up again at the batch that threw; batches before it are committed. */
export const resumeJob = employeeMutation({
  args: { jobId: v.id('importJobs') },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await loadOwnJob(ctx, jobId);
    if (job.status !== 'interrupted' || !job.interruptedFrom)
      throw new Error('import_not_interrupted');
    await ctx.db.patch(jobId, {
      status: job.interruptedFrom,
      interruptedFrom: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.features.imports.actions.runBatch, {
      jobId,
      batch: job.nextBatch,
    });
    return null;
  },
});

/** Stop a job; a batch in flight sees the status and stops. Rows are dropped, what was written stays. */
export const cancelJob = employeeMutation({
  args: { jobId: v.id('importJobs') },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await loadOwnJob(ctx, jobId);
    if (job.status === 'done' || job.status === 'cancelled') return null;
    await ctx.db.patch(jobId, {
      status: 'cancelled',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.features.imports.internal.dropRows, { jobId });
    return null;
  },
});

/** Remove a finished job and its report; the rows in error go with it. */
export const deleteJob = employeeMutation({
  args: { jobId: v.id('importJobs') },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await loadOwnJob(ctx, jobId);
    if (job.status === 'simulating' || job.status === 'running') throw new Error('import_running');
    await ctx.db.patch(jobId, { status: 'cancelled', updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.features.imports.internal.dropRows, {
      jobId,
      thenJob: true,
    });
    return null;
  },
});
