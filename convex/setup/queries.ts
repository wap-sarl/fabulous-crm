import { v } from 'convex/values';
import { query } from '../_generated/server';
import { isSetupComplete } from './helpers';

/** Public status the setup gate reads on every page load; without SETUP_TOKEN on the deployment the wizard cannot proceed. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query('appConfig').first();
    return {
      setupComplete: await isSetupComplete(ctx, cfg),
      setupTokenConfigured: !!process.env.SETUP_TOKEN,
    };
  },
});

/** False once setup is complete, so a stale wizard can't run again. */
export const verifySetupToken = query({
  args: { setupToken: v.string() },
  handler: async (ctx, args) => {
    const cfg = await ctx.db.query('appConfig').first();
    if (await isSetupComplete(ctx, cfg)) return false;
    const expected = process.env.SETUP_TOKEN;
    if (!expected) return false;
    return args.setupToken === expected;
  },
});
