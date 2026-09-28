import type { GenericQueryCtx } from 'convex/server';
import type { Doc } from '../_generated/dataModel';
import type { DataModel } from '../_generated/dataModel';

type QueryCtx = GenericQueryCtx<DataModel>;

/** A deployment with users but no config doc counts as set up, so one that predates the wizard is never locked behind it. */
export async function isSetupComplete(
  ctx: QueryCtx,
  cfg: Doc<'appConfig'> | null,
): Promise<boolean> {
  if (cfg?.setupCompletedAt) return true;
  if (cfg) return false; // config exists but setup not finalized
  const anyUser = await ctx.db.query('users').first();
  return anyUser !== null;
}
