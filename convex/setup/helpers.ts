import { GenericQueryCtx } from 'convex/server';
import { Doc } from '../_generated/dataModel';
import { DataModel } from '../_generated/dataModel';

type QueryCtx = GenericQueryCtx<DataModel>;

/**
 * Fail-safe setup-completion rule. Setup is complete when:
 *  - the config doc has `setupCompletedAt`, OR
 *  - there is no config doc yet but at least one user exists.
 *
 * The second clause guarantees existing deployments (which predate this feature
 * and have users but no config doc) are never locked behind the setup wizard,
 * even if the backfill migration hasn't been run.
 */
export async function isSetupComplete(
  ctx: QueryCtx,
  cfg: Doc<'appConfig'> | null
): Promise<boolean> {
  if (cfg?.setupCompletedAt) return true;
  if (cfg) return false; // config exists but setup not finalized
  const anyUser = await ctx.db.query('users').first();
  return anyUser !== null;
}
