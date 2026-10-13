import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

/** The deployment's one config row, or null before the setup wizard ran: readers go through here so a change of shape has one place to follow. */
export async function loadAppConfig(ctx: Pick<QueryCtx, 'db'>): Promise<Doc<'appConfig'> | null> {
  return await ctx.db.query('appConfig').first();
}
