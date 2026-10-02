import { v } from 'convex/values';
import { apiScopeValidator } from '../../_lib/validators/apiKeys';
import { settingsQuery } from '../../_lib/auth';

/** Management listing — projected: the secret hash never reaches a client. */
export const listApiKeys = settingsQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('apiKeys'),
      keyId: v.string(),
      name: v.string(),
      scopes: v.array(apiScopeValidator),
      expiresAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
      lastUsedAt: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
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
