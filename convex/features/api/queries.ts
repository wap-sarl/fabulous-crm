import { settingsQuery } from '../../_lib/auth';

/** Management listing — projected: the secret hash never reaches a client. */
export const listApiKeys = settingsQuery({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db.query('apiKeys').collect();
    return keys
      .map((key) => ({
        _id: key._id,
        keyId: key.keyId,
        name: key.name,
        scopes: key.scopes,
        expiresAt: key.expiresAt,
        revokedAt: key.revokedAt,
        lastUsedAt: key.lastUsedAt,
        createdAt: key._creationTime,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});
