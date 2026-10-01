import { v } from 'convex/values';
import { settingsMutation } from '../../_lib/auth';
import { logAudit } from '../../lib/audit/log';
import {
  checkSettings,
  dropReplacedAssets,
  mergeConnectors,
  mergeEmail,
  mergeSocialProviders,
  mergeSsoProviders,
  nextRetention,
  nextTracking,
  settingsArgs,
} from '../../lib/config/settings';
import { DEFAULT_ATTACHMENT_MAX_BYTES } from '../../_lib/validators/attachments';
import { countLiveLeadsByLifecycleStage } from '../../lib/leads/aggregates';
import { startScoreRecompute } from '../../lib/scoring/score';
import { loadLifecycleConfig } from '../../lib/leads/lifecycle';
import {
  LIFECYCLE_STAGE_KEY_RE,
  MAX_LIFECYCLE_STAGES,
  lifecycleStageValidator,
} from '../../_lib/validators/lifecycle';
import { MAX_LEAD_SCORE, MIN_LEAD_SCORE } from '../../_lib/validators/scoring';

/** For the branding assets (logo, favicon): the `storageId` the upload returns is then passed to `updateConfig`. */
export const generateUploadUrl = settingsMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/** Secrets the input omits are preserved, and the audit log records that a change happened, never the secret values. */
export const updateConfig = settingsMutation({
  args: settingsArgs,
  handler: async (ctx, args) => {
    const cfg = await ctx.db.query('appConfig').first();
    if (!cfg) throw new Error('Config not initialized');

    checkSettings(cfg, args);
    await dropReplacedAssets(ctx, cfg, args);
    const mergedSso = await mergeSsoProviders(cfg, args.ssoProviders);
    const mergedSocial = await mergeSocialProviders(cfg, args.socialProviders);
    const retention = nextRetention(cfg, args);
    const tracking = await nextTracking(ctx, cfg, args);
    const mergedConnectors = await mergeConnectors(cfg, args.connectors);
    const mergedEmail = await mergeEmail(cfg, args.email);

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
      ...(tracking !== undefined && { tracking }),
      ...(retention !== undefined && { retention }),
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
