import { internalMutation } from '../_generated/server';

/**
 * One-shot migration retiring the Gen-1 hand-rolled OIDC field
 * (`appConfig.auth.oidcProviders`) in favour of the Better Auth generic-oauth
 * field (`appConfig.auth.ssoProviders`). Rewrites `auth` wholesale so the old
 * field is dropped (a shallow patch of a nested object replaces it entirely),
 * seeding `ssoProviders` as an empty list. Idempotent — safe to run more than once.
 *
 * Must run while the schema still tolerates the old field; see the deploy notes.
 *
 *   bunx convex run seed/migrateSsoProviders:migrateOidcProvidersToSso
 */
export const migrateOidcProvidersToSso = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query('appConfig').first();
    if (!cfg) return { migrated: false, reason: 'no_config' };

    // `auth` may still carry the retired `oidcProviders` field at runtime even
    // though the current TS type no longer knows about it.
    const auth = cfg.auth as typeof cfg.auth & { oidcProviders?: unknown };
    const hadOidc = 'oidcProviders' in auth;
    if (!hadOidc && auth.ssoProviders !== undefined) {
      return { migrated: false, reason: 'already_migrated' };
    }

    await ctx.db.patch(cfg._id, {
      auth: {
        magicLinkEnabled: auth.magicLinkEnabled,
        ssoProviders: auth.ssoProviders ?? [],
        socialProviders: auth.socialProviders,
      },
    });

    return { migrated: true, droppedOidcProviders: hadOidc };
  },
});
