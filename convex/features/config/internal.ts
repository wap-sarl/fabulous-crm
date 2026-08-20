import { internalQuery } from '../../_generated/server';

/**
 * Full singleton config INCLUDING secrets (social + SSO client secrets).
 * Callable only from other server functions (the Better Auth request handler
 * resolving SSO providers, sendMagicLink). Never expose this to the client.
 */
export const getConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('appConfig').first();
  },
});
