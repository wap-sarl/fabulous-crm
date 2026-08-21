import { type Infer, v } from 'convex/values';

/**
 * A custom OIDC/SSO issuer handled by Better Auth's generic-oauth plugin — the
 * exact custom-provider analogue of a social provider. `providerId` is the stable
 * slug that rides in the OAuth callback (`/api/auth/oauth2/callback/<providerId>`)
 * and must never change once created. `clientSecret` is a SECRET — resolved
 * server-side by `createAuth` at request time (convex/auth.ts) and never returned
 * to the browser (the public config query projects only `id`/`label`).
 *
 * Unlike social providers there is no domain gating here: the invite-only GATE in
 * convex/auth.ts (`databaseHooks.user.create.before`) governs who may sign in.
 */
export const ssoProviderValidator = v.object({
  providerId: v.string(), // stable slug — the OAuth callback path segment
  label: v.string(), // button label, e.g. "Est Santé"
  issuerUrl: v.string(), // discovery base; `${issuerUrl}/.well-known/openid-configuration`
  clientId: v.string(),
  clientSecret: v.string(), // SECRET — server-side token exchange only
  scopes: v.array(v.string()), // e.g. ['openid', 'email', 'profile']
  enabled: v.boolean(),
});

export type SsoProvider = Infer<typeof ssoProviderValidator>;

/**
 * A well-known social provider handled by Better Auth (Google, Microsoft,
 * GitHub, LinkedIn). `id` is the Better Auth provider key (and OAuth callback
 * slug). `clientSecret` is a SECRET — resolved server-side by `createAuth` at
 * request time (convex/auth.ts) and never returned to the browser (the public
 * config query projects only a `configured` flag).
 */
export const socialProviderConfigValidator = v.object({
  id: v.string(), // 'google' | 'microsoft' | 'github' | 'linkedin'
  clientId: v.string(),
  clientSecret: v.string(), // SECRET — server-side token exchange only
  enabled: v.boolean(),
});

export type SocialProviderConfig = Infer<typeof socialProviderConfigValidator>;

/**
 * Email/SMS delivery configuration. `provider` selects how OUTBOUND EMAIL
 * (campaigns + auth sign-in) is sent: Brevo's transactional API or a plain SMTP
 * relay (nodemailer). SMS is decoupled — it always goes through Brevo and is
 * available whenever `brevoApiKey` is set, regardless of the email `provider`.
 *
 * Every field is optional so config docs written before this object existed stay
 * valid under strict schemaValidation; readers resolve missing values from the
 * matching env var (BREVO_API_KEY, BREVO_WEBHOOK_SECRET, BREVO_SMS_SENDER) via
 * `resolveEmailProvider`/`resolveBrevo` (convex/lib/emailProvider.ts).
 *
 * `brevoApiKey`, `brevoWebhookSecret` and `smtpPass` are SECRETS — resolved
 * server-side only, never returned to the browser (getAdminConfig projects
 * presence flags). The SMTP `From` identity reuses the top-level
 * `senderEmail`/`senderName`; there is no separate SMTP from-address.
 */
export const emailConfigValidator = v.object({
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

/**
 * Singleton runtime configuration for the CRM instance. Created by the first-run
 * setup wizard (convex/setup/mutations.ts) or backfilled for existing
 * deployments (convex/seed/bootstrapConfig.ts). Read with
 * `ctx.db.query('appConfig').first()`.
 */
export const appConfigValidator = v.object({
  setupCompletedAt: v.optional(v.number()),
  organizationName: v.string(),
  appUrl: v.string(), // canonical origin, no trailing slash
  senderEmail: v.string(),
  senderName: v.string(),
  // Custom branding uploaded via the setup wizard / settings screen. Optional so
  // existing config docs (written before these fields) stay valid under strict
  // schemaValidation; the browser only ever sees resolved URLs (config queries),
  // never the raw storage ids.
  logoStorageId: v.optional(v.id('_storage')),
  faviconStorageId: v.optional(v.id('_storage')),
  // Brand accent color (`--primary`) picked in the setup wizard / settings. A
  // `#rrggbb` hex string; optional so pre-existing config docs stay valid and so
  // an unset value falls back to the theme.css default. Derived shades
  // (`--primary-strong`/`--primary-soft`/`--ring`) are computed client-side.
  primaryColor: v.optional(v.string()),
  auth: v.object({
    magicLinkEnabled: v.boolean(),
    // Both provider lists are optional so config docs written before either field
    // existed stay valid under strict schemaValidation — read as `?? []` everywhere.
    // Custom SSO issuers (Better Auth generic-oauth), configured in the setup
    // wizard / settings exactly like `socialProviders`.
    ssoProviders: v.optional(v.array(ssoProviderValidator)),
    socialProviders: v.optional(v.array(socialProviderConfigValidator)),
  }),
  // Email/SMS delivery config. Optional so pre-existing config docs stay valid;
  // readers fall back to env vars when absent (see emailConfigValidator).
  email: v.optional(emailConfigValidator),
  updatedAt: v.number(),
  updatedBy: v.optional(v.id('users')),
});

export type AppConfig = Infer<typeof appConfigValidator>;
