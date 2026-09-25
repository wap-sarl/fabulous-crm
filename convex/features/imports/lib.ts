import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { AccessModule } from '../../_lib/validators/access';
import type { ImportEntity } from '../../_lib/validators/imports';
import type { Visibility } from '../../lib/visibility';

/** The module an entity's import writes to; a role without it cannot import it. */
export const MODULE_OF_ENTITY: Record<ImportEntity, AccessModule> = {
  lead: 'leads',
  company: 'companies',
  deal: 'deals',
  activity: 'activities',
};

export function requireImportAccess(visibility: Visibility, entity: ImportEntity): void {
  if (visibility.access[MODULE_OF_ENTITY[entity]] === 'none') {
    throw new Error(`Unauthorized: ${MODULE_OF_ENTITY[entity]}`);
  }
}

/**
 * A job of the caller's, or of anyone's for a settings holder; the rows in error hold the file's cells. The
 * module is checked again every time: a role that lost it since the job was opened cannot see or drive it.
 */
export async function loadOwnJob(
  ctx: (QueryCtx | MutationCtx) & { userId: Id<'users'>; visibility: Visibility },
  jobId: Id<'importJobs'>,
): Promise<Doc<'importJobs'>> {
  const job = await ctx.db.get(jobId);
  if (!job || (job.createdBy !== ctx.userId && !ctx.visibility.access.settings)) {
    throw new Error('import_not_found');
  }
  requireImportAccess(ctx.visibility, job.entity);
  return job;
}
