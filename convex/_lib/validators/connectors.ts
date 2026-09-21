import { type Infer, v } from 'convex/values';

export const CONNECTOR_PROVIDERS = ['google', 'microsoft'] as const;
export const connectorProviderValidator = v.union(...CONNECTOR_PROVIDERS.map((p) => v.literal(p)));
export type ConnectorProvider = Infer<typeof connectorProviderValidator>;

/** The deployment's own OAuth app for a provider; `clientSecret` is a SECRET (ciphertext, lib/crypto.ts). */
export const connectorConfigValidator = v.object({
  provider: connectorProviderValidator,
  clientId: v.string(),
  clientSecret: v.string(),
  enabled: v.boolean(),
});
export type ConnectorConfig = Infer<typeof connectorConfigValidator>;

export const connectorAccountStatusValidator = v.union(
  v.literal('active'),
  // The provider refused the refresh token: the user has to connect again.
  v.literal('error'),
  // Disconnected by the user: hidden already, the row goes once the provider has been told.
  v.literal('revoking'),
);

/** One user's account at a provider. Tokens are SECRETS: ciphertext, never returned by a query. */
export const connectorAccountValidator = v.object({
  userId: v.id('users'),
  provider: connectorProviderValidator,
  // The provider's stable subject id, and the address shown to the user.
  providerAccountId: v.string(),
  email: v.optional(v.string()),
  scopes: v.array(v.string()),
  refreshToken: v.string(),
  accessToken: v.optional(v.string()),
  accessTokenExpiresAt: v.optional(v.number()),
  status: connectorAccountStatusValidator,
  lastError: v.optional(v.string()),
  connectedAt: v.number(),
  updatedAt: v.number(),
});

/** A connection in progress: the nonce of its signed state (hashed), used once, with the PKCE verifier. */
export const connectorStateValidator = v.object({
  nonceHash: v.string(),
  userId: v.id('users'),
  provider: connectorProviderValidator,
  codeVerifier: v.string(),
  expiresAt: v.number(),
});

/** An exchanged grant waiting for its owner: claimed once, with the finish token (hashed), by the user who started the connection. */
export const connectorPendingAccountValidator = v.object({
  tokenHash: v.string(),
  userId: v.id('users'),
  provider: connectorProviderValidator,
  providerAccountId: v.string(),
  email: v.optional(v.string()),
  scopes: v.array(v.string()),
  refreshToken: v.string(),
  accessToken: v.optional(v.string()),
  accessTokenExpiresAt: v.optional(v.number()),
  expiresAt: v.number(),
});

/** What a provider said about a failed connection, waiting for the user who started it: free text never travels in an address, only its one-time token (hashed here) does. */
export const connectorFailureValidator = v.object({
  tokenHash: v.string(),
  userId: v.id('users'),
  provider: connectorProviderValidator,
  error: v.string(),
  description: v.string(),
  expiresAt: v.number(),
});
