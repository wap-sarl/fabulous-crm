import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { decryptSecret } from '../../lib';
import {
  type ConnectorProvider,
  connectorProviderValidator,
} from '../../_lib/validators/connectors';
import {
  ACCESS_TOKEN_MARGIN_MS,
  idTokenClaims,
  PROVIDERS,
  randomToken,
  redirectUri,
  sha256Base64Url,
  verifyState,
} from '../../lib/connectors';

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postForm(url: string, fields: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok && !body.error) return { error: `http_${response.status}` };
  return body;
}

/** Tells the provider a grant is over, when it has an endpoint for that. */
async function revokeAtProvider(
  provider: ConnectorProvider,
  refreshToken: string,
): Promise<{ revoked: boolean; error?: string }> {
  const revokeUrl = PROVIDERS[provider].revokeUrl;
  if (!revokeUrl) return { revoked: false };
  try {
    const response = await fetch(revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    return response.ok ? { revoked: true } : { revoked: false, error: `http_${response.status}` };
  } catch (e) {
    return { revoked: false, error: String(e).slice(0, 200) };
  }
}

export type ConnectionOutcome =
  | { ok: true; provider: string; finish: string }
  | { ok: false; error: string; provider?: string };

/** The callback's work: the state is checked and consumed, the code exchanged here with the PKCE verifier, the grant parked. */
export const completeConnection = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, { code, state }): Promise<ConnectionOutcome> => {
    const payload = await verifyState(state);
    if (!payload) return { ok: false, error: 'invalid_state' };
    const provider = payload.p;
    const pending = await ctx.runMutation(internal.features.connectors.internal.consumeState, {
      nonce: payload.n,
      provider,
    });
    if (!pending) return { ok: false, error: 'invalid_state', provider };
    const credentials = await ctx.runQuery(internal.features.connectors.internal.credentialsFor, {
      provider,
    });
    if (!credentials) return { ok: false, error: 'provider_not_configured', provider };
    const tokens = await postForm(PROVIDERS[provider].tokenUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code_verifier: pending.codeVerifier,
    });
    if (tokens.error || !tokens.access_token) {
      return { ok: false, error: tokens.error ?? 'token_exchange_failed', provider };
    }
    // Without a refresh token the connection would die with the access token.
    if (!tokens.refresh_token) return { ok: false, error: 'no_refresh_token', provider };
    const claims = idTokenClaims(provider, tokens.id_token);
    if (!claims.sub) return { ok: false, error: 'no_account_identity', provider };
    // The callback carries no session: whoever comes back with this token must be the user who started.
    const finish = randomToken();
    await ctx.runMutation(internal.features.connectors.internal.storePending, {
      tokenHash: await sha256Base64Url(finish),
      userId: pending.userId,
      provider,
      providerAccountId: claims.sub,
      email: claims.email,
      scopes: tokens.scope ? tokens.scope.split(' ') : PROVIDERS[provider].scopes,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    });
    return { ok: true, provider, finish };
  },
});

/** A usable access token for an account, refreshed when it is about to expire; null when the account needs reconnecting. */
export const accessToken = internalAction({
  args: { accountId: v.id('connectorAccounts') },
  handler: async (ctx, { accountId }): Promise<string | null> => {
    const account = await ctx.runQuery(internal.features.connectors.internal.accountSecrets, {
      accountId,
    });
    if (account?.status !== 'active') return null;
    if (
      account.accessToken &&
      account.accessTokenExpiresAt &&
      account.accessTokenExpiresAt - ACCESS_TOKEN_MARGIN_MS > Date.now()
    ) {
      return account.accessToken;
    }
    const credentials = await ctx.runQuery(internal.features.connectors.internal.credentialsFor, {
      provider: account.provider,
    });
    if (!credentials) return null;
    const tokens = await postForm(PROVIDERS[account.provider].tokenUrl, {
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    if (tokens.error || !tokens.access_token) {
      // `invalid_grant`: revoked at the provider or expired. Anything else may be transient, the account stays.
      if (tokens.error === 'invalid_grant') {
        await ctx.runMutation(internal.features.connectors.internal.recordRefresh, {
          accountId,
          error: tokens.error,
        });
      }
      return null;
    }
    await ctx.runMutation(internal.features.connectors.internal.recordRefresh, {
      accountId,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      refreshToken: tokens.refresh_token,
    });
    return tokens.access_token;
  },
});

/** Tells the provider the grant is over, when it has an endpoint for that, then the row goes whatever it answered. */
export const revokeAndRemove = internalAction({
  args: { accountId: v.id('connectorAccounts') },
  handler: async (ctx, { accountId }): Promise<null> => {
    const account = await ctx.runQuery(internal.features.connectors.internal.accountSecrets, {
      accountId,
    });
    // Reconnected since: the row holds a fresh grant, which stays.
    if (account?.status !== 'revoking') return null;
    const { revoked, error } = await revokeAtProvider(account.provider, account.refreshToken);
    await ctx.runMutation(internal.features.connectors.internal.removeAccount, {
      accountId,
      revoked,
      error,
    });
    return null;
  },
});

/** Revokes a grant that never became an account (claimed by nobody, or by the wrong user); the token arrives as stored. */
export const revokeGrant = internalAction({
  args: { provider: connectorProviderValidator, refreshToken: v.string() },
  returns: v.null(),
  handler: async (_ctx, { provider, refreshToken }) => {
    await revokeAtProvider(provider, await decryptSecret(refreshToken));
    return null;
  },
});
