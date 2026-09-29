import { retentionPolicyOf } from '../../_lib/validators/retention';
import { trackingConfigOf } from '../../lib/tracking/config';
import { CONNECTOR_PROVIDERS } from '../../_lib/validators/connectors';
import { credentialsSource, PROVIDERS, redirectUriOrNull } from '../../lib/connectors/oauth';
import { query } from '../../_generated/server';
import { settingsQuery, employeeQuery } from '../../_lib/auth';
import { isSetupComplete } from '../../setup/helpers';
import { SOCIAL_PROVIDERS } from '../../_lib/socialProviders';
import { emailPresence } from '../../lib/email/provider';
import { extensions } from '../../extensions';
import { loadLifecycleConfig } from '../../lib/leads/lifecycle';
import {
  DEFAULT_ATTACHMENT_MAX_BYTES,
  DEFAULT_ATTACHMENT_RETENTION_DAYS,
} from '../../_lib/validators/attachments';

/** Public and pre-auth: an explicit allowlist only, never client secrets, issuer URLs or allowed domains; of a provider only `id` and `label` are exposed. */
export const getPublicConfig = query({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query('appConfig').first();
    const setupComplete = await isSetupComplete(ctx, cfg);

    return {
      ...(await extensions.publicConfig(ctx)),
      setupComplete,
      organizationName: cfg?.organizationName ?? 'CRM',
      // Short-lived URLs, public so the login page and the runtime favicon can render before sign-in.
      logoUrl: cfg?.logoStorageId ? await ctx.storage.getUrl(cfg.logoStorageId) : null,
      faviconUrl: cfg?.faviconStorageId ? await ctx.storage.getUrl(cfg.faviconStorageId) : null,
      // Brand accent color; null when unset so the client keeps the theme default.
      primaryColor: cfg?.primaryColor ?? null,
      // The origin serving Better Auth's routes (`.convex.site`): the setup wizard builds the OAuth callback URLs it shows from it.
      authCallbackBaseUrl: process.env.CONVEX_SITE_URL ?? null,
      auth: {
        magicLink: cfg?.auth.magicLinkEnabled ?? true,
        // The whole catalog with a `configured` flag, never the secrets: the wizard shows each provider's status, the login page a button for the configured ones.
        socialProviders: SOCIAL_PROVIDERS.map((p) => {
          const sp = cfg?.auth.socialProviders?.find((s) => s.id === p.key);
          return {
            id: p.key,
            label: p.label,
            configured: !!sp?.enabled && !!sp.clientId && !!sp.clientSecret,
          };
        }),
        // Custom SSO issuers, secrets excluded; their callback is `<authCallbackBaseUrl>/api/auth/oauth2/callback/<id>`.
        customSsoProviders: (cfg?.auth.ssoProviders ?? [])
          .filter((p) => p.enabled)
          .map((p) => ({ id: p.providerId, label: p.label })),
      },
    };
  },
});

/** For the settings screen: secrets are replaced by presence flags, the real values never leave the server. */
export const getAdminConfig = settingsQuery({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query('appConfig').first();
    if (!cfg) return null;

    return {
      organizationName: cfg.organizationName,
      appUrl: cfg.appUrl,
      senderEmail: cfg.senderEmail,
      senderName: cfg.senderName,
      logoUrl: cfg.logoStorageId ? await ctx.storage.getUrl(cfg.logoStorageId) : null,
      faviconUrl: cfg.faviconStorageId ? await ctx.storage.getUrl(cfg.faviconStorageId) : null,
      primaryColor: cfg.primaryColor ?? null,
      attachments: {
        maxSizeBytes: cfg.attachments?.maxSizeBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES,
        retentionDays: cfg.attachments?.retentionDays ?? DEFAULT_ATTACHMENT_RETENTION_DAYS,
      },
      retention: retentionPolicyOf(cfg),
      tracking: trackingConfigOf(cfg),
      auth: {
        magicLinkEnabled: cfg.auth.magicLinkEnabled,
        // The whole catalog, so a provider never configured shows an empty clientId, disabled.
        socialProviders: SOCIAL_PROVIDERS.map((p) => {
          const sp = cfg.auth.socialProviders?.find((s) => s.id === p.key);
          return {
            id: p.key,
            label: p.label,
            clientId: sp?.clientId ?? '',
            hasClientSecret: (sp?.clientSecret.length ?? 0) > 0,
            enabled: sp?.enabled ?? false,
          };
        }),
        ssoProviders: (cfg.auth.ssoProviders ?? []).map((p) => ({
          providerId: p.providerId,
          label: p.label,
          issuerUrl: p.issuerUrl,
          clientId: p.clientId,
          hasClientSecret: p.clientSecret.length > 0,
          scopes: p.scopes,
          enabled: p.enabled,
        })),
      },
      // Connector OAuth apps: the secret becomes a presence flag; `managed` tells that the host supplies credentials.
      connectors: CONNECTOR_PROVIDERS.map((provider) => {
        const own = cfg.connectors?.find((c) => c.provider === provider);
        return {
          provider,
          label: PROVIDERS[provider].label,
          clientId: own?.clientId ?? '',
          hasClientSecret: (own?.clientSecret.length ?? 0) > 0,
          enabled: own?.enabled ?? false,
          source: credentialsSource(cfg, provider),
          redirectUri: redirectUriOrNull(),
        };
      }),
      // The presence flags fold in the env fallback, so a deployment not migrated yet reads as configured.
      email: (() => {
        const e = cfg.email;
        const brevo = emailPresence(cfg);
        return {
          provider: e?.provider ?? 'brevo',
          hasBrevoApiKey: brevo.hasBrevoApiKey,
          hasBrevoWebhookSecret: brevo.hasBrevoWebhookSecret,
          brevoSmsSender: e?.brevoSmsSender ?? '',
          smtpHost: e?.smtpHost ?? '',
          smtpPort: e?.smtpPort ?? null,
          smtpSecure: e?.smtpSecure ?? false,
          smtpUser: e?.smtpUser ?? '',
          hasSmtpPass: (e?.smtpPass?.length ?? 0) > 0,
          smsAvailable: brevo.smsAvailable,
        };
      })(),
    };
  },
});

export const getLifecycleConfig = employeeQuery({
  args: {},
  handler: async (ctx) => await loadLifecycleConfig(ctx),
});

/** Open to every employee, so nothing secret: the campaign composer uses it to disable the Brevo-only options under SMTP. */
export const getEmailCapabilities = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query('appConfig').first();
    const presence = emailPresence(cfg);
    return {
      emailProvider: cfg?.email?.provider ?? 'brevo',
      smsAvailable: presence.smsAvailable,
      emailConfigured: presence.emailConfigured,
    };
  },
});
