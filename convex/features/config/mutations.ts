import { v } from 'convex/values';
import { adminMutation } from '../../_lib/auth';
import { logAudit } from '../../lib';
import { ATTACHMENT_MAX_BYTES_CEILING } from '../../_lib/validators/attachments';
import { countLiveLeadsByLifecycleStage } from '../../lib/leadAggregates';
import { loadLifecycleConfig } from '../../lib/lifecycle';
import {
  LIFECYCLE_STAGE_KEY_RE,
  MAX_LIFECYCLE_STAGES,
  lifecycleStageValidator,
} from '../../_lib/validators/lifecycle';
import type {
  SsoProvider,
  SocialProviderConfig,
  EmailConfig,
} from '../../_lib/validators/appConfig';

/** `#rrggbb` — the only accepted form for the brand accent color. */
const hexColorRe = /^#[0-9a-fA-F]{6}$/;

/**
 * Admin-only upload URL for branding assets (logo/favicon) on the settings
 * screen. The client POSTs the file to the returned URL and receives a
 * `storageId`, which is then passed to `updateConfig`.
 */
export const generateUploadUrl = adminMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Input shape for a custom SSO provider from an admin settings form. Same
 * secret-preservation rule as social: `clientSecret` omitted/empty keeps the
 * existing stored secret (matched by `providerId`), so the form never has to
 * round-trip the real secret to the browser.
 */
const ssoProviderInput = v.object({
  providerId: v.string(),
  label: v.string(),
  issuerUrl: v.string(),
  clientId: v.string(),
  clientSecret: v.optional(v.string()),
  scopes: v.array(v.string()),
  enabled: v.boolean(),
});

/**
 * Input shape for a well-known social provider. Same secret-preservation rule as
 * OIDC: `clientSecret` omitted/empty keeps the existing stored secret (matched
 * by `id`).
 */
const socialProviderInput = v.object({
  id: v.string(),
  clientId: v.string(),
  clientSecret: v.optional(v.string()),
  enabled: v.boolean(),
});

/**
 * Input shape for the email/SMS delivery config. The three secrets
 * (`brevoApiKey`, `brevoWebhookSecret`, `smtpPass`) are optional — omitted or
 * empty keeps the stored value, so the form never round-trips real secrets.
 */
const emailConfigInput = v.object({
  provider: v.union(v.literal('brevo'), v.literal('smtp')),
  brevoApiKey: v.optional(v.string()),
  brevoWebhookSecret: v.optional(v.string()),
  brevoSmsSender: v.optional(v.string()),
  smtpHost: v.optional(v.string()),
  smtpPort: v.optional(v.number()),
  smtpSecure: v.optional(v.boolean()),
  smtpUser: v.optional(v.string()),
  smtpPass: v.optional(v.string()),
});

/**
 * Update the singleton config (settings screen). Non-secret fields are patched
 * directly; provider secrets are preserved when the input omits them. The audit
 * log records that a change happened but never the secret values themselves.
 */
export const updateConfig = adminMutation({
  args: {
    organizationName: v.optional(v.string()),
    appUrl: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    senderName: v.optional(v.string()),
    magicLinkEnabled: v.optional(v.boolean()),
    ssoProviders: v.optional(v.array(ssoProviderInput)),
    socialProviders: v.optional(v.array(socialProviderInput)),
    logoStorageId: v.optional(v.id('_storage')),
    faviconStorageId: v.optional(v.id('_storage')),
    primaryColor: v.optional(v.string()),
    email: v.optional(emailConfigInput),
    attachmentsMaxSizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cfg = await ctx.db.query('appConfig').first();
    if (!cfg) throw new Error('Config not initialized');

    if (args.primaryColor !== undefined && !hexColorRe.test(args.primaryColor)) {
      throw new Error('invalid_primary_color');
    }
    if (
      args.attachmentsMaxSizeBytes !== undefined &&
      (!Number.isInteger(args.attachmentsMaxSizeBytes) ||
        args.attachmentsMaxSizeBytes < 1024 * 1024 ||
        args.attachmentsMaxSizeBytes > ATTACHMENT_MAX_BYTES_CEILING)
    ) {
      throw new Error('invalid_attachment_max_size');
    }

    // Replacing a branding asset: drop the previous blob so it doesn't orphan.
    if (args.logoStorageId && cfg.logoStorageId && cfg.logoStorageId !== args.logoStorageId) {
      await ctx.storage.delete(cfg.logoStorageId);
    }
    if (
      args.faviconStorageId &&
      cfg.faviconStorageId &&
      cfg.faviconStorageId !== args.faviconStorageId
    ) {
      await ctx.storage.delete(cfg.faviconStorageId);
    }

    const mergedSso: SsoProvider[] | undefined = args.ssoProviders?.map((p) => {
      const existing = (cfg.auth.ssoProviders ?? []).find((e) => e.providerId === p.providerId);
      const clientSecret =
        p.clientSecret && p.clientSecret.length > 0
          ? p.clientSecret
          : (existing?.clientSecret ?? '');
      return {
        providerId: p.providerId,
        label: p.label,
        issuerUrl: p.issuerUrl,
        clientId: p.clientId,
        clientSecret,
        scopes: p.scopes,
        enabled: p.enabled,
      };
    });

    const mergedSocial: SocialProviderConfig[] | undefined = args.socialProviders?.map((p) => {
      const existing = cfg.auth.socialProviders?.find((e) => e.id === p.id);
      const clientSecret =
        p.clientSecret && p.clientSecret.length > 0
          ? p.clientSecret
          : (existing?.clientSecret ?? '');
      return {
        id: p.id,
        clientId: p.clientId,
        clientSecret,
        enabled: p.enabled,
      };
    });

    // Email config: same secret-preservation rule — an omitted/empty secret
    // keeps the stored value (matched on the existing config, singleton).
    let mergedEmail: EmailConfig | undefined;
    if (args.email) {
      const e = args.email;
      const prev = cfg.email;
      const keep = (incoming: string | undefined, existing: string | undefined) =>
        incoming && incoming.length > 0 ? incoming : (existing ?? '');
      mergedEmail = {
        provider: e.provider,
        brevoApiKey: keep(e.brevoApiKey, prev?.brevoApiKey),
        brevoWebhookSecret: keep(e.brevoWebhookSecret, prev?.brevoWebhookSecret),
        brevoSmsSender: e.brevoSmsSender ?? prev?.brevoSmsSender ?? '',
        smtpHost: e.smtpHost ?? prev?.smtpHost ?? '',
        smtpPort: e.smtpPort ?? prev?.smtpPort,
        smtpSecure: e.smtpSecure ?? prev?.smtpSecure ?? false,
        smtpUser: e.smtpUser ?? prev?.smtpUser ?? '',
        smtpPass: keep(e.smtpPass, prev?.smtpPass),
      };
      // Refuse to switch to a half-configured SMTP relay: host + port are the
      // minimum needed to connect (the From identity comes from senderEmail).
      if (mergedEmail.provider === 'smtp' && (!mergedEmail.smtpHost || !mergedEmail.smtpPort)) {
        throw new Error('smtp_config_incomplete');
      }
    }

    await ctx.db.patch(cfg._id, {
      ...(args.organizationName !== undefined && { organizationName: args.organizationName }),
      ...(args.appUrl !== undefined && { appUrl: args.appUrl.replace(/\/+$/, '') }),
      ...(args.senderEmail !== undefined && { senderEmail: args.senderEmail.trim().toLowerCase() }),
      ...(args.senderName !== undefined && { senderName: args.senderName }),
      ...(args.logoStorageId !== undefined && { logoStorageId: args.logoStorageId }),
      ...(args.faviconStorageId !== undefined && { faviconStorageId: args.faviconStorageId }),
      ...(args.primaryColor !== undefined && { primaryColor: args.primaryColor.toLowerCase() }),
      auth: {
        magicLinkEnabled: args.magicLinkEnabled ?? cfg.auth.magicLinkEnabled,
        ssoProviders: mergedSso ?? cfg.auth.ssoProviders,
        socialProviders: mergedSocial ?? cfg.auth.socialProviders,
      },
      ...(mergedEmail !== undefined && { email: mergedEmail }),
      ...(args.attachmentsMaxSizeBytes !== undefined && {
        attachments: { maxSizeBytes: args.attachmentsMaxSizeBytes },
      }),
      updatedAt: Date.now(),
      updatedBy: ctx.userId,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'appConfig',
      entityId: cfg._id,
      action: 'update',
      // Metadata deliberately excludes secret values.
      metadata: {
        fields: Object.keys(args).filter(
          (k) =>
            k !== 'ssoProviders' &&
            k !== 'socialProviders' &&
            k !== 'email' &&
            (args as Record<string, unknown>)[k] !== undefined,
        ),
        ssoProviderIds: mergedSso?.map((p) => p.providerId),
        socialProviderIds: mergedSocial?.map((p) => p.id),
        emailProvider: mergedEmail?.provider,
      },
    });

    return { success: true };
  },
});

export const updateLifecycleConfig = adminMutation({
  args: {
    stages: v.array(lifecycleStageValidator),
    defaultStage: v.string(),
    allowRegression: v.boolean(),
  },
  handler: async (ctx, args) => {
    const cfg = await ctx.db.query('appConfig').first();
    if (!cfg) throw new Error('Config not initialized');

    if (args.stages.length === 0) throw new Error('lifecycle_no_stages');
    if (args.stages.length > MAX_LIFECYCLE_STAGES) throw new Error('lifecycle_too_many_stages');
    const stages = args.stages.map((s) => ({ key: s.key, label: s.label.trim() }));
    const keys = new Set<string>();
    for (const stage of stages) {
      if (!LIFECYCLE_STAGE_KEY_RE.test(stage.key)) throw new Error('lifecycle_invalid_key');
      if (keys.has(stage.key)) throw new Error('lifecycle_duplicate_key');
      if (!stage.label) throw new Error('lifecycle_empty_label');
      keys.add(stage.key);
    }
    if (!keys.has(args.defaultStage)) throw new Error('lifecycle_invalid_default');

    const previous = await loadLifecycleConfig(ctx);
    for (const stage of previous.stages) {
      if (keys.has(stage.key)) continue;
      if ((await countLiveLeadsByLifecycleStage(ctx, stage.key)) > 0) {
        throw new Error('lifecycle_stage_in_use');
      }
    }

    await ctx.db.patch(cfg._id, {
      lifecycle: { stages, defaultStage: args.defaultStage, allowRegression: args.allowRegression },
      updatedAt: Date.now(),
      updatedBy: ctx.userId,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'appConfig',
      entityId: cfg._id,
      action: 'update',
      metadata: {
        fields: ['lifecycle'],
        lifecycleStages: stages.map((s) => s.key),
        defaultStage: args.defaultStage,
        allowRegression: args.allowRegression,
      },
    });

    return { success: true };
  },
});
