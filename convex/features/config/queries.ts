import { query } from '../../_generated/server';
import { adminQuery, employeeQuery } from '../../_lib/auth';
import { isSetupComplete } from '../../setup/helpers';
import { SOCIAL_PROVIDERS } from '../../_lib/socialProviders';
import { resolveBrevo, resolveEmailProvider, isEmailProviderConfigured } from '../../lib';
import { loadLifecycleConfig } from '../../lib/lifecycle';

/**
 * Public, pre-auth config the login page and setup gate rely on. Returns an
 * explicit allowlist only — NEVER client secrets, issuer URLs, or allowed
 * domains. `clientId` is public by OAuth design but we don't even need it here
 * (the auth URL is built via an action), so only `id`/`label` are exposed.
 */
export const getPublicConfig = query({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query('appConfig').first();
    const setupComplete = await isSetupComplete(ctx, cfg);

    return {
      setupComplete,
      organizationName: cfg?.organizationName ?? 'CRM',
      // Resolved, short-lived URLs for the custom branding (null when unset).
      // Public so the login page + runtime favicon can render pre-auth.
      logoUrl: cfg?.logoStorageId ? await ctx.storage.getUrl(cfg.logoStorageId) : null,
      faviconUrl: cfg?.faviconStorageId ? await ctx.storage.getUrl(cfg.faviconStorageId) : null,
      // Brand accent color; null when unset so the client keeps the theme default.
      primaryColor: cfg?.primaryColor ?? null,
      // Origin where Better Auth's HTTP routes are served (`.convex.site`), used
      // to build the OAuth callback URLs shown in the setup wizard. Null if the
      // deployment hasn't injected it yet (shouldn't happen on a live backend).
      authCallbackBaseUrl: process.env.CONVEX_SITE_URL ?? null,
      auth: {
        magicLink: cfg?.auth.magicLinkEnabled ?? true,
        // Well-known providers handled by Better Auth. The full catalog is
        // returned with a `configured` flag derived from the DB (enabled + both
        // credentials present) so the wizard can show status + callback for each;
        // the login page renders a button only for configured ones. Secrets are
        // never exposed — only the boolean.
        socialProviders: SOCIAL_PROVIDERS.map((p) => {
          const sp = cfg?.auth.socialProviders?.find((s) => s.id === p.key);
          return {
            id: p.key,
            label: p.label,
            configured: !!sp?.enabled && !!sp.clientId && !!sp.clientSecret,
          };
        }),
        // Custom OIDC/SSO issuers handled by Better Auth's generic-oauth plugin,
        // configured in the DB (setup wizard / settings) just like social ones.
        // The login page renders a button per enabled provider. Callback:
        // `<authCallbackBaseUrl>/api/auth/oauth2/callback/<id>`. Secrets excluded.
        customSsoProviders: (cfg?.auth.ssoProviders ?? [])
          .filter((p) => p.enabled)
          .map((p) => ({ id: p.providerId, label: p.label })),
      },
    };
  },
});

/**
 * Admin-facing config for a settings screen. Secrets are replaced by boolean
 * presence flags; the real values never leave the server.
 */
export const getAdminConfig = adminQuery({
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
      auth: {
        magicLinkEnabled: cfg.auth.magicLinkEnabled,
        // Full social-provider catalog, each merged with its stored credentials.
        // The secret is replaced by a presence flag; the real value never leaves
        // the server. Providers never configured show empty clientId + disabled.
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
        // Custom SSO issuers (Better Auth generic-oauth). Secret → presence flag;
        // the real value never leaves the server.
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
      // Email/SMS delivery config. Secrets → presence flags (env fallback folded
      // in so a pre-migration deployment reads as "configured"); the real values
      // never leave the server. `smsAvailable` is derived from Brevo credentials.
      email: (() => {
        const e = cfg.email;
        const brevo = resolveBrevo(cfg);
        return {
          provider: e?.provider ?? 'brevo',
          hasBrevoApiKey: brevo.apiKey.length > 0,
          hasBrevoWebhookSecret: brevo.webhookSecret.length > 0,
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

/**
 * Lightweight, non-secret email capabilities for the campaign composer (used by
 * employees, not just admins). Tells the UI which channels/features are usable
 * so it can disable Brevo-only options under SMTP.
 */
export const getEmailCapabilities = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query('appConfig').first();
    const brevo = resolveBrevo(cfg);
    return {
      emailProvider: cfg?.email?.provider ?? 'brevo',
      smsAvailable: brevo.smsAvailable,
      emailConfigured: isEmailProviderConfigured(resolveEmailProvider(cfg)),
    };
  },
});
