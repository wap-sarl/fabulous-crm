import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { employeeMutation } from '../../_lib/auth';
import { connectorProviderValidator } from '../../_lib/validators/connectors';
import {
  PROVIDERS,
  randomToken,
  redirectUri,
  resolveCredentials,
  sha256Base64Url,
  signState,
  STATE_TTL_MS,
} from '../../lib/connectors';

/** Starts a connection: a one-time signed state and a PKCE challenge, and the provider's consent URL to go to. */
export const startConnection = employeeMutation({
  args: { provider: connectorProviderValidator },
  handler: async (ctx, { provider }) => {
    const credentials = await resolveCredentials(await ctx.db.query('appConfig').first(), provider);
    if (!credentials) throw new Error('connector_not_configured');
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
      client_id: credentials.clientId,
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
