import { v } from 'convex/values';
import { settingsMutation } from '../../_lib/auth';
import {
  API_KEY_ID_BYTES,
  API_KEY_PREFIX,
  API_KEY_SECRET_BYTES,
  apiScopeValidator,
  validateApiKeyShape,
} from '../../_lib/validators/apiKeys';
import { createAuditFields, generateHexToken, logAudit, updateAuditFields } from '../../lib';
import { hashApiKeySecret } from '../../lib/apiAuth';

/**
 * Create an API key. The full key is returned ONCE — only its salted hash is
 * stored, so it can never be shown again.
 */
export const createApiKey = settingsMutation({
  args: {
    name: v.string(),
    scopes: v.array(apiScopeValidator),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const error = validateApiKeyShape(args);
    if (error) throw new Error(error);
    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) {
      throw new Error('api_key_expiry_in_past');
    }

    // 4 random bytes collide only pathologically; regenerate rather than reason about it.
    let keyId = generateHexToken(API_KEY_ID_BYTES);
    while (
      await ctx.db
        .query('apiKeys')
        .withIndex('by_keyId', (q) => q.eq('keyId', keyId))
        .first()
    ) {
      keyId = generateHexToken(API_KEY_ID_BYTES);
    }

    const secret = generateHexToken(API_KEY_SECRET_BYTES);
    const id = await ctx.db.insert('apiKeys', {
      keyId,
      secretHash: await hashApiKeySecret(secret),
      name: args.name.trim(),
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'apiKey',
      entityId: id,
      action: 'create',
      metadata: { keyId, scopes: args.scopes },
    });
    return { id, key: `${API_KEY_PREFIX}_${keyId}_${secret}` };
  },
});

export const updateApiKey = settingsMutation({
  args: {
    id: v.id('apiKeys'),
    name: v.optional(v.string()),
    scopes: v.optional(v.array(apiScopeValidator)),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.id);
    if (!key) throw new Error('api_key_not_found');
    const patch: Partial<typeof key> = {};
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.scopes !== undefined) patch.scopes = args.scopes;
    const error = validateApiKeyShape({
      name: patch.name ?? key.name,
      scopes: patch.scopes ?? key.scopes,
    });
    if (error) throw new Error(error);
    await ctx.db.patch(args.id, { ...patch, ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'apiKey',
      entityId: args.id,
      action: 'update',
      metadata: { fields: Object.keys(patch) },
    });
  },
});

/** Revocation is soft and permanent: the row stays for the audit trail. */
export const revokeApiKey = settingsMutation({
  args: { id: v.id('apiKeys') },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.id);
    if (!key) throw new Error('api_key_not_found');
    if (key.revokedAt !== undefined) return;
    await ctx.db.patch(args.id, { revokedAt: Date.now(), ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'apiKey',
      entityId: args.id,
      action: 'update',
      metadata: { revoked: true, keyId: key.keyId },
    });
  },
});
