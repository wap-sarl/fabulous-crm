import { type ConnectorConfig, connectorProviderValidator } from '../../_lib/validators/connectors';
import { isWithinRetentionBounds, RETENTION_KEYS } from '../../_lib/validators/retention';
import {
  trackingModeValidator,
  trackingOriginsSchema,
  trackingPrivacyUrlSchema,
  trackingRetentionSchema,
} from '../../_lib/validators/tracking';
import { trackingConfigOf } from '../../lib/tracking/config';
import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { settingsMutation } from '../../_lib/auth';
import { logAudit } from '../../lib/audit/log';
import { encryptSecret } from '../../lib/security/crypto';
import {
  ATTACHMENT_MAX_BYTES_CEILING,
  ATTACHMENT_RETENTION_MAX_DAYS,
  ATTACHMENT_RETENTION_MIN_DAYS,
  DEFAULT_ATTACHMENT_MAX_BYTES,
} from '../../_lib/validators/attachments';
import { MAX_DYNAMIC_LISTS_CEILING } from '../../_lib/validators/leadLists';
import { countLiveLeadsByLifecycleStage } from '../../lib/leads/aggregates';
import { startScoreRecompute } from '../../lib/scoring/score';
import { loadLifecycleConfig } from '../../lib/leads/lifecycle';
import {
  LIFECYCLE_STAGE_KEY_RE,
  MAX_LIFECYCLE_STAGES,
  lifecycleStageValidator,
} from '../../_lib/validators/lifecycle';
import { MAX_LEAD_SCORE, MIN_LEAD_SCORE } from '../../_lib/validators/scoring';
import type {
  SsoProvider,
  SocialProviderConfig,
  EmailConfig,
} from '../../_lib/validators/appConfig';
import { ssoProviderIdSchema } from '../../_lib/validators/appConfig';

/** `#rrggbb` — the only accepted form for the brand accent color. */
const hexColorRe = /^#[0-9a-fA-F]{6}$/;

/** For the branding assets (logo, favicon): the `storageId` the upload returns is then passed to `updateConfig`. */
export const generateUploadUrl = settingsMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/** An omitted or empty `clientSecret` keeps the stored one (matched by `providerId`), so the form never round-trips the real secret to the browser. */
const ssoProviderInput = v.object({
  providerId: v.string(),
  label: v.string(),
  issuerUrl: v.string(),
  clientId: v.string(),
  clientSecret: v.optional(v.string()),
  scopes: v.array(v.string()),
  enabled: v.boolean(),
});

/** A connector OAuth app as the settings send it: an omitted or empty secret keeps the stored one. */
const connectorInput = v.object({
  provider: connectorProviderValidator,
  clientId: v.string(),
  clientSecret: v.optional(v.string()),
  enabled: v.boolean(),
});

/** An omitted or empty `clientSecret` keeps the stored one (matched by `id`). */
const socialProviderInput = v.object({
  id: v.string(),
  clientId: v.string(),
  clientSecret: v.optional(v.string()),
  enabled: v.boolean(),
});

/** The three secrets (`brevoApiKey`, `brevoWebhookSecret`, `smtpPass`) keep their stored value when omitted or empty, so the form never round-trips them. */
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

/** Secrets the input omits are preserved, and the audit log records that a change happened, never the secret values. */
export const updateConfig = settingsMutation({
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
    attachmentsRetentionDays: v.optional(v.number()),
    listsMaxDynamicLists: v.optional(v.number()),
    retentionSoftDeleteDays: v.optional(v.number()),
    retentionEventDays: v.optional(v.number()),
    retentionAuditDays: v.optional(v.number()),
    trackingEnabled: v.optional(v.boolean()),
    trackingMode: v.optional(trackingModeValidator),
    trackingRetentionDays: v.optional(v.number()),
    trackingAllowedOrigins: v.optional(v.array(v.string())),
    // `null` clears it.
    trackingPrivacyUrl: v.optional(v.union(v.string(), v.null())),
    connectors: v.optional(v.array(connectorInput)),
  },
  handler: async (ctx, args) => {
    const cfg = await ctx.db.query('appConfig').first();
    if (!cfg) throw new Error('Config not initialized');

    if (args.primaryColor !== undefined && !hexColorRe.test(args.primaryColor)) {
      throw new Error('invalid_primary_color');
    }
    if (args.ssoProviders) {
      // An id already stored stays as it is: its callback path must not change.
      const stored = new Set((cfg.auth.ssoProviders ?? []).map((p) => p.providerId));
      const ids = args.ssoProviders.map((p) => p.providerId);
      if (ids.some((id) => !stored.has(id) && !ssoProviderIdSchema.safeParse(id).success)) {
        throw new Error('sso_provider_invalid_id');
      }
      if (new Set(ids).size !== ids.length) throw new Error('sso_provider_duplicate_id');
    }
    if (
      args.attachmentsMaxSizeBytes !== undefined &&
      (!Number.isInteger(args.attachmentsMaxSizeBytes) ||
        args.attachmentsMaxSizeBytes < 1024 * 1024 ||
        args.attachmentsMaxSizeBytes > ATTACHMENT_MAX_BYTES_CEILING)
    ) {
      throw new Error('invalid_attachment_max_size');
    }
    if (
      args.attachmentsRetentionDays !== undefined &&
      (!Number.isInteger(args.attachmentsRetentionDays) ||
        args.attachmentsRetentionDays < ATTACHMENT_RETENTION_MIN_DAYS ||
        args.attachmentsRetentionDays > ATTACHMENT_RETENTION_MAX_DAYS)
    ) {
      throw new Error('invalid_attachment_retention');
    }
    if (
      args.listsMaxDynamicLists !== undefined &&
      (!Number.isInteger(args.listsMaxDynamicLists) ||
        args.listsMaxDynamicLists < 1 ||
        args.listsMaxDynamicLists > MAX_DYNAMIC_LISTS_CEILING)
    ) {
      throw new Error('invalid_max_dynamic_lists');
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

    // Secrets are stored as ciphertext (lib/security/crypto.ts); an omitted or empty one keeps the stored value.
    const mergedSso: SsoProvider[] | undefined = args.ssoProviders
      ? await Promise.all(
          args.ssoProviders.map(async (p) => {
            const existing = (cfg.auth.ssoProviders ?? []).find(
              (e) => e.providerId === p.providerId,
            );
            const clientSecret =
              p.clientSecret && p.clientSecret.length > 0
                ? await encryptSecret(p.clientSecret)
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
          }),
        )
      : undefined;

    const mergedSocial: SocialProviderConfig[] | undefined = args.socialProviders
      ? await Promise.all(
          args.socialProviders.map(async (p) => {
            const existing = cfg.auth.socialProviders?.find((e) => e.id === p.id);
            const clientSecret =
              p.clientSecret && p.clientSecret.length > 0
                ? await encryptSecret(p.clientSecret)
                : (existing?.clientSecret ?? '');
            return {
              id: p.id,
              clientId: p.clientId,
              clientSecret,
              enabled: p.enabled,
            };
          }),
        )
      : undefined;

    const retentionArgs = {
      softDeleteDays: args.retentionSoftDeleteDays,
      eventDays: args.retentionEventDays,
      auditDays: args.retentionAuditDays,
    };
    for (const key of RETENTION_KEYS) {
      const days = retentionArgs[key];
      if (days !== undefined && !isWithinRetentionBounds(key, days)) {
        throw new Error(`retention_out_of_bounds:${key}`);
      }
    }
    const retentionChanged = RETENTION_KEYS.some((key) => retentionArgs[key] !== undefined);
    const tracking = trackingConfigOf(cfg);
    const trackingChanged = [
      args.trackingEnabled,
      args.trackingMode,
      args.trackingRetentionDays,
      args.trackingAllowedOrigins,
      args.trackingPrivacyUrl,
    ].some((value) => value !== undefined);
    const trackingRetention = trackingRetentionSchema.safeParse(
      args.trackingRetentionDays ?? tracking.retentionDays,
    );
    if (!trackingRetention.success) throw new Error('tracking_retention_out_of_bounds');
    const trackingOrigins = trackingOriginsSchema.safeParse(
      args.trackingAllowedOrigins ?? tracking.allowedOrigins,
    );
    if (!trackingOrigins.success) throw new Error('tracking_origins_invalid');
    const privacyUrl =
      args.trackingPrivacyUrl === undefined ? tracking.privacyUrl : args.trackingPrivacyUrl;
    if (privacyUrl && !trackingPrivacyUrlSchema.safeParse(privacyUrl).success) {
      throw new Error('tracking_privacy_url_invalid');
    }
    const nextTracking = {
      enabled: args.trackingEnabled ?? tracking.enabled,
      mode: args.trackingMode ?? tracking.mode,
      retentionDays: trackingRetention.data,
      allowedOrigins: trackingOrigins.data,
      ...(privacyUrl && { privacyUrl: privacyUrl.trim() }),
      ...(tracking.ceilingHitAt !== undefined && { ceilingHitAt: tracking.ceilingHitAt }),
    };
    if (trackingChanged && nextTracking.enabled) {
      // A beacon is accepted from the listed sites only: tracking without one would record nothing.
      if (nextTracking.allowedOrigins.length === 0) throw new Error('tracking_origins_required');
      // Named tracking is profiling: the banner must say so and link to the policy.
      if (nextTracking.mode === 'named' && !nextTracking.privacyUrl) {
        throw new Error('tracking_privacy_url_required');
      }
    }
    // Leaving named mode detaches what it attached; going back to it starts from nothing.
    if (trackingChanged && tracking.mode === 'named' && nextTracking.mode === 'anonymous') {
      await ctx.scheduler.runAfter(0, internal.features.tracking.internal.detachAll, {});
    }

    const mergedConnectors: ConnectorConfig[] | undefined = args.connectors
      ? await Promise.all(
          args.connectors.map(async (c) => {
            const existing = cfg.connectors?.find((e) => e.provider === c.provider);
            return {
              provider: c.provider,
              clientId: c.clientId.trim(),
              clientSecret:
                c.clientSecret && c.clientSecret.length > 0
                  ? await encryptSecret(c.clientSecret)
                  : (existing?.clientSecret ?? ''),
              enabled: c.enabled,
            };
          }),
        )
      : undefined;
    // An enabled connector nobody could use would only fail at the first connection.
    if (mergedConnectors?.some((c) => c.enabled && (!c.clientId || !c.clientSecret))) {
      throw new Error('connector_credentials_required');
    }

    // Same rule for the email secrets: an omitted or empty one keeps the stored value.
    let mergedEmail: EmailConfig | undefined;
    if (args.email) {
      const e = args.email;
      const prev = cfg.email;
      const keep = async (incoming: string | undefined, existing: string | undefined) =>
        incoming && incoming.length > 0 ? await encryptSecret(incoming) : (existing ?? '');
      mergedEmail = {
        provider: e.provider,
        brevoApiKey: await keep(e.brevoApiKey, prev?.brevoApiKey),
        brevoWebhookSecret: await keep(e.brevoWebhookSecret, prev?.brevoWebhookSecret),
        brevoSmsSender: e.brevoSmsSender ?? prev?.brevoSmsSender ?? '',
        smtpHost: e.smtpHost ?? prev?.smtpHost ?? '',
        smtpPort: e.smtpPort ?? prev?.smtpPort,
        smtpSecure: e.smtpSecure ?? prev?.smtpSecure ?? false,
        smtpUser: e.smtpUser ?? prev?.smtpUser ?? '',
        smtpPass: await keep(e.smtpPass, prev?.smtpPass),
      };
      // A half-configured SMTP relay is refused: host and port are the minimum to connect, the From identity comes from senderEmail.
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
      ...((args.attachmentsMaxSizeBytes !== undefined ||
        args.attachmentsRetentionDays !== undefined) && {
        attachments: {
          maxSizeBytes:
            args.attachmentsMaxSizeBytes ??
            cfg.attachments?.maxSizeBytes ??
            DEFAULT_ATTACHMENT_MAX_BYTES,
          retentionDays: args.attachmentsRetentionDays ?? cfg.attachments?.retentionDays,
        },
      }),
      ...(args.listsMaxDynamicLists !== undefined && {
        lists: { ...cfg.lists, maxDynamicLists: args.listsMaxDynamicLists },
      }),
      ...(mergedConnectors !== undefined && { connectors: mergedConnectors }),
      ...(trackingChanged && { tracking: nextTracking }),
      ...(retentionChanged && {
        retention: Object.fromEntries(
          RETENTION_KEYS.map((key) => [key, retentionArgs[key] ?? cfg.retention?.[key]]),
        ),
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
            k !== 'connectors' &&
            (args as Record<string, unknown>)[k] !== undefined,
        ),
        ssoProviderIds: mergedSso?.map((p) => p.providerId),
        socialProviderIds: mergedSocial?.map((p) => p.id),
        emailProvider: mergedEmail?.provider,
        connectorProviders: mergedConnectors?.map((c) => c.provider),
      },
    });

    return { success: true };
  },
});

export const updateLifecycleConfig = settingsMutation({
  args: {
    stages: v.array(lifecycleStageValidator),
    defaultStage: v.string(),
    allowRegression: v.boolean(),
    scorePromotion: v.optional(v.object({ stage: v.string(), minScore: v.number() })),
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

    if (args.scorePromotion) {
      const { stage, minScore } = args.scorePromotion;
      if (!keys.has(stage)) throw new Error('lifecycle_invalid_promotion_stage');
      if (!Number.isInteger(minScore) || minScore < MIN_LEAD_SCORE || minScore > MAX_LEAD_SCORE) {
        throw new Error('lifecycle_invalid_promotion_score');
      }
    }

    await ctx.db.patch(cfg._id, {
      lifecycle: {
        stages,
        defaultStage: args.defaultStage,
        allowRegression: args.allowRegression,
        scorePromotion: args.scorePromotion,
      },
      updatedAt: Date.now(),
      updatedBy: ctx.userId,
    });

    // A new promotion threshold must sweep existing leads, not wait for their next write.
    const promotion = args.scorePromotion;
    const before = previous.scorePromotion;
    if (
      promotion &&
      (before?.stage !== promotion.stage || before?.minScore !== promotion.minScore)
    ) {
      await startScoreRecompute(ctx);
    }

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
