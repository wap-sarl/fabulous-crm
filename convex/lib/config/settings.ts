import { type ObjectType, v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  type EmailConfig,
  type SocialProviderConfig,
  type SsoProvider,
  ssoProviderIdSchema,
} from '../../_lib/validators/appConfig';
import {
  ATTACHMENT_MAX_BYTES_CEILING,
  ATTACHMENT_RETENTION_MAX_DAYS,
  ATTACHMENT_RETENTION_MIN_DAYS,
} from '../../_lib/validators/attachments';
import { type ConnectorConfig, connectorProviderValidator } from '../../_lib/validators/connectors';
import { MAX_DYNAMIC_LISTS_CEILING } from '../../_lib/validators/leadLists';
import { isWithinRetentionBounds, RETENTION_KEYS } from '../../_lib/validators/retention';
import {
  trackingModeValidator,
  trackingOriginsSchema,
  trackingPrivacyUrlSchema,
  trackingRetentionSchema,
} from '../../_lib/validators/tracking';
import { encryptSecret } from '../security/crypto';
import { trackingConfigOf } from '../tracking/config';

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

/** What the settings pages send: every field is optional, an omitted one keeps what is stored. */
export const settingsArgs = {
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
};
type SettingsArgs = ObjectType<typeof settingsArgs>;
type Config = Doc<'appConfig'>;

/** `#rrggbb` — the only accepted form for the brand accent color. */
const hexColorRe = /^#[0-9a-fA-F]{6}$/;

/** Secrets are stored as ciphertext (lib/security/crypto.ts); an omitted or empty one keeps the stored value. */
const keepSecret = async (incoming: string | undefined, existing: string | undefined) =>
  incoming && incoming.length > 0 ? await encryptSecret(incoming) : (existing ?? '');

/** The colour, the ids of the new sign-in providers and the bounded numbers, refused before anything is written. */
export function checkSettings(cfg: Config, args: SettingsArgs): void {
  if (args.primaryColor !== undefined && !hexColorRe.test(args.primaryColor)) {
    throw new Error('invalid_primary_color');
  }
  if (args.ssoProviders) {
    // An id already stored is not checked again: its callback path is declared at the issuer.
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
}

/** Replacing a branding asset: drop the previous blob so it doesn't orphan. */
export async function dropReplacedAssets(
  ctx: MutationCtx,
  cfg: Config,
  args: SettingsArgs,
): Promise<void> {
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
}

export async function mergeSsoProviders(
  cfg: Config,
  providers: SettingsArgs['ssoProviders'],
): Promise<SsoProvider[] | undefined> {
  if (!providers) return undefined;
  return await Promise.all(
    providers.map(async (p) => {
      const existing = (cfg.auth.ssoProviders ?? []).find((e) => e.providerId === p.providerId);
      return {
        providerId: p.providerId,
        label: p.label,
        issuerUrl: p.issuerUrl,
        clientId: p.clientId,
        clientSecret: await keepSecret(p.clientSecret, existing?.clientSecret),
        scopes: p.scopes,
        enabled: p.enabled,
      };
    }),
  );
}

export async function mergeSocialProviders(
  cfg: Config,
  providers: SettingsArgs['socialProviders'],
): Promise<SocialProviderConfig[] | undefined> {
  if (!providers) return undefined;
  return await Promise.all(
    providers.map(async (p) => {
      const existing = cfg.auth.socialProviders?.find((e) => e.id === p.id);
      return {
        id: p.id,
        clientId: p.clientId,
        clientSecret: await keepSecret(p.clientSecret, existing?.clientSecret),
        enabled: p.enabled,
      };
    }),
  );
}

/** The durations as they will be stored, undefined when none was given. */
export function nextRetention(cfg: Config, args: SettingsArgs): Config['retention'] {
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
  if (!RETENTION_KEYS.some((key) => retentionArgs[key] !== undefined)) return undefined;
  return Object.fromEntries(
    RETENTION_KEYS.map((key) => [key, retentionArgs[key] ?? cfg.retention?.[key]]),
  );
}

/** The tracking as it will be stored, undefined when nothing of it was given; leaving named mode schedules the detachment. */
export async function nextTracking(
  ctx: MutationCtx,
  cfg: Config,
  args: SettingsArgs,
): Promise<Config['tracking']> {
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
  return trackingChanged ? nextTracking : undefined;
}

export async function mergeConnectors(
  cfg: Config,
  connectors: SettingsArgs['connectors'],
): Promise<ConnectorConfig[] | undefined> {
  if (!connectors) return undefined;
  const merged = await Promise.all(
    connectors.map(async (c) => {
      const existing = cfg.connectors?.find((e) => e.provider === c.provider);
      return {
        provider: c.provider,
        clientId: c.clientId.trim(),
        clientSecret: await keepSecret(c.clientSecret, existing?.clientSecret),
        enabled: c.enabled,
      };
    }),
  );
  // An enabled connector nobody could use would only fail at the first connection.
  if (merged.some((c) => c.enabled && (!c.clientId || !c.clientSecret))) {
    throw new Error('connector_credentials_required');
  }
  return merged;
}

export async function mergeEmail(
  cfg: Config,
  email: SettingsArgs['email'],
): Promise<EmailConfig | undefined> {
  if (!email) return undefined;
  const e = email;
  const prev = cfg.email;
  const mergedEmail = {
    provider: e.provider,
    brevoApiKey: await keepSecret(e.brevoApiKey, prev?.brevoApiKey),
    brevoWebhookSecret: await keepSecret(e.brevoWebhookSecret, prev?.brevoWebhookSecret),
    brevoSmsSender: e.brevoSmsSender ?? prev?.brevoSmsSender ?? '',
    smtpHost: e.smtpHost ?? prev?.smtpHost ?? '',
    smtpPort: e.smtpPort ?? prev?.smtpPort,
    smtpSecure: e.smtpSecure ?? prev?.smtpSecure ?? false,
    smtpUser: e.smtpUser ?? prev?.smtpUser ?? '',
    smtpPass: await keepSecret(e.smtpPass, prev?.smtpPass),
  };
  // A half-configured SMTP relay is refused: host and port are the minimum to connect, the From identity comes from senderEmail.
  if (mergedEmail.provider === 'smtp' && (!mergedEmail.smtpHost || !mergedEmail.smtpPort)) {
    throw new Error('smtp_config_incomplete');
  }
  return mergedEmail;
}
