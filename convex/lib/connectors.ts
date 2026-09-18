// Connector foundation: provider catalogue, the signed OAuth state, PKCE, and where the credentials come from.
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { AppConfig } from '../_lib/validators/appConfig';
import { CONNECTOR_PROVIDERS, type ConnectorProvider } from '../_lib/validators/connectors';
import { decryptSecret, timingSafeEqual } from './crypto';

export const STATE_TTL_MS = 10 * 60 * 1000;
/** How long an exchanged grant waits for the signed-in user to claim it. */
export const FINISH_TTL_MS = 5 * 60 * 1000;
/** Access tokens are refreshed this long before they expire. */
export const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;

export interface ProviderEndpoints {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Null when the provider has no endpoint to revoke a refresh token (Microsoft). */
  revokeUrl: string | null;
  /** Identity only: features that need more (calendar, mail) add their scopes when they arrive. */
  scopes: string[];
  authorizeParams: Record<string, string>;
}

export const PROVIDERS: Record<ConnectorProvider, ProviderEndpoints> = {
  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    scopes: ['openid', 'email', 'profile'],
    // A refresh token only comes with offline access, and again only when consent is asked.
    authorizeParams: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    label: 'Microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    revokeUrl: null,
    scopes: ['openid', 'email', 'profile', 'offline_access'],
    authorizeParams: {},
  },
};

const encoder = new TextEncoder();
const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromBase64Url = (text: string): string =>
  atob(
    text
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(text.length / 4) * 4, '='),
  );
const bufferOf = (text: string): ArrayBuffer => {
  const bytes = encoder.encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

export const randomToken = (bytes = 32): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Base64Url(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bufferOf(text))));
}

/** The key the state is signed with: `OAUTH_STATE_SECRET`, shared with a callback dispatcher; else the auth secret. */
function stateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('oauth_state_secret_missing');
  return `connector-state:${secret}`;
}

async function hmac(text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    bufferOf(stateSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, bufferOf(text))));
}

/** What travels in the OAuth `state`: whom a dispatcher forwards to, which connection this is, until when. */
export interface StatePayload {
  /** The deployment's identifier for a callback dispatcher (`OAUTH_CALLBACK_TENANT`); empty without one. */
  t: string;
  p: ConnectorProvider;
  n: string;
  /** Expiry, Unix seconds. */
  e: number;
}

export async function signState(payload: StatePayload): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

/** The payload of a state signed here and not expired; null for anything else. */
export async function verifyState(state: string, now = Date.now()): Promise<StatePayload | null> {
  const [body, signature, extra] = state.split('.');
  if (!body || !signature || extra !== undefined) return null;
  if (!timingSafeEqual(signature, await hmac(body))) return null;
  try {
    const payload = JSON.parse(fromBase64Url(body)) as StatePayload;
    if (typeof payload.n !== 'string' || typeof payload.e !== 'number') return null;
    if (!CONNECTOR_PROVIDERS.includes(payload.p) || payload.e * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Where the provider sends the browser back: a dispatcher's single callback when one is configured, else this deployment. */
export function redirectUri(): string {
  const dispatcher = (process.env.OAUTH_CALLBACK_BASE ?? '').trim().replace(/\/+$/, '');
  if (dispatcher) return `${dispatcher}/oauth/callback`;
  const site = (process.env.CONVEX_SITE_URL ?? '').replace(/\/+$/, '');
  if (!site) throw new Error('convex_site_url_missing');
  return `${site}/connectors/callback`;
}

/** The same, for a settings screen that must render even on a deployment missing its site URL. */
export function redirectUriOrNull(): string | null {
  try {
    return redirectUri();
  } catch {
    return null;
  }
}

export interface ConnectorCredentials {
  clientId: string;
  clientSecret: string;
  /** `own`: configured in the settings; `managed`: supplied through the deployment environment. */
  source: 'own' | 'managed';
}

const ENV_PREFIX: Record<ConnectorProvider, string> = {
  google: 'CONNECTOR_GOOGLE',
  microsoft: 'CONNECTOR_MICROSOFT',
};

/** Which source would serve a provider, without decrypting anything: for queries and the settings page. */
export function credentialsSource(
  config: Pick<AppConfig, 'connectors'> | null,
  provider: ConnectorProvider,
): ConnectorCredentials['source'] | null {
  const own = config?.connectors?.find((c) => c.provider === provider);
  if (own?.enabled && own.clientId && own.clientSecret) return 'own';
  const prefix = ENV_PREFIX[provider];
  return process.env[`${prefix}_CLIENT_ID`] && process.env[`${prefix}_CLIENT_SECRET`]
    ? 'managed'
    : null;
}

/** The client id alone, for the consent URL: the secret is neither read nor decrypted. */
export function resolveClientId(
  config: Pick<AppConfig, 'connectors'> | null,
  provider: ConnectorProvider,
): string | null {
  const source = credentialsSource(config, provider);
  if (source === 'own')
    return config?.connectors?.find((c) => c.provider === provider)?.clientId ?? null;
  if (source === 'managed') return process.env[`${ENV_PREFIX[provider]}_CLIENT_ID`] ?? null;
  return null;
}

/** The OAuth app to use: the deployment's own when configured and enabled, else the environment's. */
export async function resolveCredentials(
  config: Pick<AppConfig, 'connectors'> | null,
  provider: ConnectorProvider,
): Promise<ConnectorCredentials | null> {
  const source = credentialsSource(config, provider);
  if (source === 'own') {
    const own = config?.connectors?.find((c) => c.provider === provider);
    if (!own) return null;
    return {
      clientId: own.clientId,
      clientSecret: await decryptSecret(own.clientSecret),
      source,
    };
  }
  if (source === 'managed') {
    const prefix = ENV_PREFIX[provider];
    return {
      clientId: process.env[`${prefix}_CLIENT_ID`] as string,
      clientSecret: process.env[`${prefix}_CLIENT_SECRET`] as string,
      source,
    };
  }
  return null;
}

/** The claims of an ID token received straight from the token endpoint over TLS: read, not verified. */
export function idTokenClaims(
  provider: ConnectorProvider,
  idToken: string | undefined,
): { sub?: string; email?: string } {
  const payload = idToken?.split('.')[1];
  if (!payload) return {};
  try {
    const claims = JSON.parse(fromBase64Url(payload)) as {
      sub?: string;
      oid?: string;
      email?: string;
      preferred_username?: string;
    };
    // Microsoft's `sub` is pairwise per app registration: `oid` stays the same when the OAuth app changes.
    const sub = provider === 'microsoft' ? (claims.oid ?? claims.sub) : claims.sub;
    return { sub, email: claims.email ?? claims.preferred_username };
  } catch {
    return {};
  }
}

/** A grant nobody may claim any more: the row goes and the provider is told, so no live token is left behind. */
export async function discardPendingAccount(
  ctx: MutationCtx,
  pending: Doc<'connectorPendingAccounts'>,
): Promise<void> {
  await ctx.db.delete(pending._id);
  await ctx.scheduler.runAfter(0, internal.features.connectors.actions.revokeGrant, {
    provider: pending.provider,
    refreshToken: pending.refreshToken,
  });
}
