import { retentionConfigValidator } from './retention';
import { trackingConfigValidator } from './tracking';
import { type Infer, v } from 'convex/values';
import { z } from 'zod';
import { connectorConfigValidator } from './connectors';
import { attachmentsConfigValidator } from './attachments';
import { lifecycleConfigValidator } from './lifecycle';

/** A custom OIDC issuer: `providerId` rides in the callback path and must never change; only the invite-only gate of convex/auth.ts decides who signs in. */
export const ssoProviderValidator = v.object({
  providerId: v.string(), // stable slug — the OAuth callback path segment
  label: v.string(), // button label, e.g. "Mon organisation"
  issuerUrl: v.string(), // discovery base; `${issuerUrl}/.well-known/openid-configuration`
  clientId: v.string(),
  clientSecret: v.string(), // SECRET — server-side token exchange only
  scopes: v.array(v.string()), // e.g. ['openid', 'email', 'profile']
  enabled: v.boolean(),
});

export type SsoProvider = Infer<typeof ssoProviderValidator>;

/** The id of a sign-in provider as the callback path carries it: lowercase ASCII words joined by hyphens, as `slugOf` writes them. */
export const ssoProviderIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** `id` is the Better Auth provider key and the OAuth callback slug; `clientSecret` never reaches the browser, the public config query only says `configured`. */
export const socialProviderConfigValidator = v.object({
  id: v.string(), // 'google' | 'microsoft' | 'github' | 'linkedin'
  clientId: v.string(),
  clientSecret: v.string(), // SECRET — server-side token exchange only
  enabled: v.boolean(),
});

export type SocialProviderConfig = Infer<typeof socialProviderConfigValidator>;

/** `provider` only routes email: SMS always goes through Brevo once `brevoApiKey` is set; a missing Brevo field falls back to its env var (convex/lib/email/provider.ts). */
const emailConfigValidator = v.object({
  provider: v.union(v.literal('brevo'), v.literal('smtp')),
  brevoApiKey: v.optional(v.string()), // SECRET — also powers SMS + webhooks
  brevoWebhookSecret: v.optional(v.string()), // SECRET
  brevoSmsSender: v.optional(v.string()),
  smtpHost: v.optional(v.string()),
  smtpPort: v.optional(v.number()),
  smtpSecure: v.optional(v.boolean()), // true => 465 implicit TLS; false => STARTTLS
  smtpUser: v.optional(v.string()),
  smtpPass: v.optional(v.string()), // SECRET
});

export type EmailConfig = Infer<typeof emailConfigValidator>;

/** A singleton: the setup wizard creates it (convex/setup/mutations.ts), or convex/seed/bootstrapConfig.ts backfills it on an existing deployment. */
export const appConfigValidator = v.object({
  setupCompletedAt: v.optional(v.number()),
  organizationName: v.string(),
  appUrl: v.string(), // canonical origin, no trailing slash
  senderEmail: v.string(),
  senderName: v.string(),
  // Optional so older config docs stay valid under strict schemaValidation; the browser sees resolved URLs, never the storage ids.
  logoStorageId: v.optional(v.id('_storage')),
  faviconStorageId: v.optional(v.id('_storage')),
  // The `--primary` accent as a `#rrggbb` string; unset, theme.css decides, and the derived shades are computed client-side.
  primaryColor: v.optional(v.string()),
  auth: v.object({
    magicLinkEnabled: v.boolean(),
    // Both lists are optional so older config docs stay valid under strict schemaValidation: read them as `?? []`.
    ssoProviders: v.optional(v.array(ssoProviderValidator)),
    socialProviders: v.optional(v.array(socialProviderConfigValidator)),
  }),
  // Optional so older config docs stay valid; absent, readers fall back to the env vars.
  email: v.optional(emailConfigValidator),
  lifecycle: v.optional(lifecycleConfigValidator),
  attachments: v.optional(attachmentsConfigValidator),
  lists: v.optional(v.object({ maxDynamicLists: v.optional(v.number()) })),
  // How long deleted records, events and the audit journal are kept (validators/retention.ts).
  retention: v.optional(retentionConfigValidator),
  // Web tracking: the script's switch, anonymous or named, the views' retention (validators/tracking.ts).
  tracking: v.optional(trackingConfigValidator),
  // The deployment's own OAuth apps for connectors; absent, the environment may supply managed ones (lib/connectors/oauth.ts).
  connectors: v.optional(v.array(connectorConfigValidator)),
  updatedAt: v.number(),
  updatedBy: v.optional(v.id('users')),
});

export type AppConfig = Infer<typeof appConfigValidator>;
