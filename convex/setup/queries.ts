import { v } from 'convex/values';
import { query } from '../_generated/server';
import { isSetupComplete } from './helpers';

/**
 * Public status the setup gate reads on every page load.
 * `setupTokenConfigured` tells the wizard whether SETUP_TOKEN is set on the
 * deployment (fail-closed: without it the wizard cannot proceed).
 */
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

/**
 * Verify the setup token entered in the wizard's first step. Returns false once
 * setup is already complete so a stale wizard can't re-run.
 */
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
