import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../../_generated/server';
import { connectorProviderValidator } from '../../_lib/validators/connectors';
import { decryptSecret, encryptSecret, logAudit } from '../../lib';
import { resolveCredentials, sha256Base64Url } from '../../lib/connectors';

/** A state is good for one callback: consuming it deletes it, so a replayed callback finds nothing. */
export const consumeState = internalMutation({
  args: { nonce: v.string(), provider: connectorProviderValidator },
  handler: async (ctx, { nonce, provider }) => {
    const now = Date.now();
    // Connections nobody finished are swept a few at a time.
    const stale = await ctx.db
      .query('connectorStates')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(20);
    for (const row of stale) await ctx.db.delete(row._id);
    const nonceHash = await sha256Base64Url(nonce);
    const state = await ctx.db
      .query('connectorStates')
      .withIndex('by_nonceHash', (q) => q.eq('nonceHash', nonceHash))
      .unique();
    if (!state) return null;
    await ctx.db.delete(state._id);
    if (state.provider !== provider || state.expiresAt < now) return null;
    return { userId: state.userId, codeVerifier: state.codeVerifier };
  },
});

/** The OAuth app's credentials, in clear, for the action that talks to the provider. */
export const credentialsFor = internalQuery({
  args: { provider: connectorProviderValidator },
  handler: async (ctx, { provider }) =>
    await resolveCredentials(await ctx.db.query('appConfig').first(), provider),
});

/** One account per user and provider: connecting again replaces it. Tokens are stored as ciphertext. */
export const storeAccount = internalMutation({
  args: {
    userId: v.id('users'),
    provider: connectorProviderValidator,
    providerAccountId: v.string(),
    email: v.optional(v.string()),
    scopes: v.array(v.string()),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('connectorAccounts')
      .withIndex('by_user_provider', (q) =>
        q.eq('userId', args.userId).eq('provider', args.provider),
      )
      .unique();
    const fields = {
      ...args,
      refreshToken: await encryptSecret(args.refreshToken),
      accessToken: args.accessToken ? await encryptSecret(args.accessToken) : undefined,
      status: 'active' as const,
      lastError: undefined,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    const accountId =
      existing?._id ?? (await ctx.db.insert('connectorAccounts', { ...fields, connectedAt: now }));
    await logAudit({
      ctx,
      userId: args.userId,
      entityType: 'connectorAccount',
      entityId: accountId,
      action: existing ? 'update' : 'create',
      metadata: { provider: args.provider, scopes: args.scopes },
    });
    return accountId;
  },
});

/** The tokens in clear, for the refresh and revocation actions only. */
export const accountSecrets = internalQuery({
  args: { accountId: v.id('connectorAccounts') },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    if (!account) return null;
    return {
      provider: account.provider,
      status: account.status,
      refreshToken: await decryptSecret(account.refreshToken),
      accessToken: account.accessToken ? await decryptSecret(account.accessToken) : null,
      accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
    };
  },
});

export const recordRefresh = internalMutation({
  args: {
    accountId: v.id('connectorAccounts'),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    // Some providers rotate the refresh token on use.
    refreshToken: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.status === 'revoking') return;
    const now = Date.now();
    if (args.error) {
      await ctx.db.patch(args.accountId, {
        status: 'error',
        lastError: args.error,
        accessToken: undefined,
        accessTokenExpiresAt: undefined,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(args.accountId, {
      status: 'active',
      lastError: undefined,
      accessToken: args.accessToken ? await encryptSecret(args.accessToken) : undefined,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      ...(args.refreshToken ? { refreshToken: await encryptSecret(args.refreshToken) } : {}),
      updatedAt: now,
    });
  },
});

export const removeAccount = internalMutation({
  args: {
    accountId: v.id('connectorAccounts'),
    revoked: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, revoked, error }) => {
    const account = await ctx.db.get(accountId);
    if (!account) return;
    await ctx.db.delete(accountId);
    await logAudit({
      ctx,
      userId: account.userId,
      entityType: 'connectorAccount',
      entityId: accountId,
      action: 'delete',
      metadata: { provider: account.provider, revokedAtProvider: revoked, error },
    });
  },
});
