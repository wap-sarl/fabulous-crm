import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { employeeMutation } from '../../_lib/auth';
import { connectorProviderValidator } from '../../_lib/validators/connectors';
import { logAudit } from '../../lib';
import {
  discardPendingAccount,
  PROVIDERS,
  randomToken,
  redirectUri,
  resolveClientId,
  sha256Base64Url,
  signState,
  STATE_TTL_MS,
} from '../../lib/connectors';

/** Starts a connection: a one-time signed state and a PKCE challenge, and the provider's consent URL to go to. */
export const startConnection = employeeMutation({
  args: { provider: connectorProviderValidator },
  handler: async (ctx, { provider }) => {
    const clientId = resolveClientId(await ctx.db.query('appConfig').first(), provider);
    if (!clientId) throw new Error('connector_not_configured');
    const now = Date.now();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    await ctx.db.insert('connectorStates', {
      nonceHash: await sha256Base64Url(nonce),
      userId: ctx.userId,
      provider,
      codeVerifier,
      expiresAt: now + STATE_TTL_MS,
    });
    const state = await signState({
      t: process.env.OAUTH_CALLBACK_TENANT ?? '',
      p: provider,
      n: nonce,
      e: Math.floor((now + STATE_TTL_MS) / 1000),
    });
    const endpoints = PROVIDERS[provider];
    const url = new URL(endpoints.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: endpoints.scopes.join(' '),
      state,
      code_challenge: await sha256Base64Url(codeVerifier),
      code_challenge_method: 'S256',
      ...endpoints.authorizeParams,
    }).toString();
    return { url: url.toString() };
  },
});

/** Claims the grant the callback parked: only the signed-in user who started the connection gets the account. */
export const finishConnection = employeeMutation({
  args: { token: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), provider: connectorProviderValidator }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, { token }) => {
    const tokenHash = await sha256Base64Url(token);
    const pending = await ctx.db
      .query('connectorPendingAccounts')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .unique();
    if (!pending) return { ok: false as const, error: 'invalid_finish' };
    const now = Date.now();
    // Refusals return rather than throw: a throw would roll the discard back and leave the token usable.
    if (pending.userId !== ctx.userId || pending.expiresAt < now) {
      await discardPendingAccount(ctx, pending);
      const error = pending.userId !== ctx.userId ? 'account_mismatch' : 'invalid_finish';
      return { ok: false as const, error };
    }
    await ctx.db.delete(pending._id);
    const { _id, _creationTime, tokenHash: _hash, expiresAt: _expiry, ...grant } = pending;
    // One account per user and provider: connecting again replaces it.
    const existing = await ctx.db
      .query('connectorAccounts')
      .withIndex('by_user_provider', (q) =>
        q.eq('userId', ctx.userId).eq('provider', grant.provider),
      )
      .unique();
    const fields = { ...grant, status: 'active' as const, lastError: undefined, updatedAt: now };
    if (existing) await ctx.db.patch(existing._id, fields);
    const accountId =
      existing?._id ?? (await ctx.db.insert('connectorAccounts', { ...fields, connectedAt: now }));
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'connectorAccount',
      entityId: accountId,
      action: existing ? 'update' : 'create',
      metadata: { provider: grant.provider, scopes: grant.scopes },
    });
    return { ok: true as const, provider: grant.provider };
  },
});

/** What the provider said about a connection that failed, handed once to the signed-in user who started it; null for anyone or anything else. */
export const claimFailure = employeeMutation({
  args: { token: v.string() },
  returns: v.union(v.object({ error: v.string(), description: v.string() }), v.null()),
  handler: async (ctx, { token }) => {
    const tokenHash = await sha256Base64Url(token);
    const failure = await ctx.db
      .query('connectorFailures')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .unique();
    if (!failure) return null;
    // Returned, never thrown: a throw would roll the deletion back and leave the token usable.
    await ctx.db.delete(failure._id);
    if (failure.userId !== ctx.userId || failure.expiresAt < Date.now()) return null;
    return { error: failure.error, description: failure.description };
  },
});

/** Disconnects the caller's account: hidden at once, revoked at the provider, then removed. */
export const disconnect = employeeMutation({
  args: { provider: connectorProviderValidator },
  returns: v.null(),
  handler: async (ctx, { provider }) => {
    const account = await ctx.db
      .query('connectorAccounts')
      .withIndex('by_user_provider', (q) => q.eq('userId', ctx.userId).eq('provider', provider))
      .unique();
    if (!account) throw new Error('connector_account_not_found');
    await ctx.db.patch(account._id, { status: 'revoking', updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.features.connectors.actions.revokeAndRemove, {
      accountId: account._id,
    });
    return null;
  },
});
