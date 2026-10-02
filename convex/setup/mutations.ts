import { emailSchema, follows, hexColorSchema, httpUrlSchema } from '../_lib/validators/fields';
import { refusal } from '../_lib/refusal';
import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import {
  ssoProviderIdSchema,
  ssoProviderValidator,
  socialProviderConfigValidator,
} from '../_lib/validators/appConfig';
import { logAudit } from '../lib/audit/log';
import { encryptSecret } from '../lib/security/crypto';
import { isSetupComplete } from './helpers';
import { ensureDefaultRoles } from '../lib/roles/access';

/** Upload URL for the wizard's logo and favicon: guarded by SETUP_TOKEN so it may run before any user exists, and refused once setup is complete. */
export const generateSetupUploadUrl = mutation({
  args: { setupToken: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const expected = process.env.SETUP_TOKEN;
    if (!expected) throw refusal('setup_token_not_configured');
    if (args.setupToken !== expected) throw refusal('invalid_setup_token');
    const cfg = await ctx.db.query('appConfig').first();
    if (await isSetupComplete(ctx, cfg)) throw refusal('setup_already_complete');
    return await ctx.storage.generateUploadUrl();
  },
});

/** Runs before any sign-in, as holding SETUP_TOKEN proves control of the deployment; no session is minted, the owner signs in through Better Auth, which links `authId`. */
export const completeSetup = mutation({
  args: {
    setupToken: v.string(),
    organizationName: v.string(),
    appUrl: v.string(),
    senderEmail: v.string(),
    senderName: v.string(),
    auth: v.object({
      magicLinkEnabled: v.boolean(),
      ssoProviders: v.array(ssoProviderValidator),
      socialProviders: v.optional(v.array(socialProviderConfigValidator)),
    }),
    admin: v.object({
      email: v.string(),
      firstName: v.string(),
      lastName: v.string(),
    }),
    logoStorageId: v.optional(v.id('_storage')),
    faviconStorageId: v.optional(v.id('_storage')),
    primaryColor: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean(), adminEmail: v.string() }),
  handler: async (ctx, args) => {
    const expected = process.env.SETUP_TOKEN;
    if (!expected) throw refusal('setup_token_not_configured');
    if (args.setupToken !== expected) throw refusal('invalid_setup_token');

    const existingCfg = await ctx.db.query('appConfig').first();
    if (await isSetupComplete(ctx, existingCfg)) {
      throw refusal('setup_already_complete');
    }
    // Extra guard: never write a second config doc.
    if (existingCfg) throw refusal('setup_already_complete');

    const adminEmail = args.admin.email.trim().toLowerCase();
    const senderEmail = args.senderEmail.trim().toLowerCase();
    if (!follows(emailSchema, adminEmail)) throw refusal('invalid_admin_email');
    if (!follows(emailSchema, senderEmail)) throw refusal('invalid_sender_email');
    if (!follows(httpUrlSchema, args.appUrl)) throw refusal('invalid_app_url');
    if (args.primaryColor !== undefined && !follows(hexColorSchema, args.primaryColor)) {
      throw refusal('invalid_primary_color');
    }
    const hasSocial = (args.auth.socialProviders ?? []).some((sp) => sp.enabled);
    const hasSso = args.auth.ssoProviders.some((p) => p.enabled);
    if (!args.auth.magicLinkEnabled && !hasSocial && !hasSso) {
      throw refusal('no_auth_method_enabled');
    }
    // An enabled social provider must carry both credentials.
    for (const sp of args.auth.socialProviders ?? []) {
      if (sp.enabled && (!sp.clientId.trim() || !sp.clientSecret.trim())) {
        throw refusal('social_provider_missing_credentials');
      }
    }
    // An enabled SSO provider must carry an issuer + both credentials.
    for (const p of args.auth.ssoProviders) {
      if (p.enabled && (!p.issuerUrl.trim() || !p.clientId.trim() || !p.clientSecret.trim())) {
        throw refusal('sso_provider_missing_credentials');
      }
    }
    // The id is stored with the provider, enabled or not: the callback path declared at the issuer carries it.
    const ssoIds = args.auth.ssoProviders.map((p) => p.providerId);
    if (ssoIds.some((id) => !ssoProviderIdSchema.safeParse(id).success)) {
      throw refusal('sso_provider_invalid_id');
    }
    if (new Set(ssoIds).size !== ssoIds.length) throw refusal('sso_provider_duplicate_id');

    const now = Date.now();

    // Provision the first admin.
    const userId = await ctx.db.insert('users', {
      type: 'employee',
      role: 'admin',
      email: adminEmail,
      firstName: args.admin.firstName.trim(),
      lastName: args.admin.lastName.trim(),
      birthDate: '1970-01-01',
      jobTitle: 'CRM',
      phone: '',
      address: { street: '', streetNumber: '', postalCode: '', city: '', country: 'FR' },
      updatedAt: now,
    });

    await ensureDefaultRoles(ctx, userId);
    await ctx.db.insert('appConfig', {
      setupCompletedAt: now,
      organizationName: args.organizationName.trim(),
      appUrl: args.appUrl.replace(/\/+$/, ''),
      senderEmail,
      senderName: args.senderName.trim(),
      ...(args.logoStorageId && { logoStorageId: args.logoStorageId }),
      ...(args.faviconStorageId && { faviconStorageId: args.faviconStorageId }),
      ...(args.primaryColor && { primaryColor: args.primaryColor.toLowerCase() }),
      // Secrets are stored as ciphertext (lib/security/crypto.ts).
      auth: {
        ...args.auth,
        ssoProviders: await Promise.all(
          args.auth.ssoProviders.map(async (p) => ({
            ...p,
            clientSecret: await encryptSecret(p.clientSecret),
          })),
        ),
        socialProviders: args.auth.socialProviders
          ? await Promise.all(
              args.auth.socialProviders.map(async (p) => ({
                ...p,
                clientSecret: await encryptSecret(p.clientSecret),
              })),
            )
          : undefined,
      },
      // Brevo by default, its credentials backfilled from env; the resolvers fall back to env regardless.
      email: {
        provider: 'brevo' as const,
        brevoApiKey: await encryptSecret(process.env.BREVO_API_KEY ?? ''),
        brevoWebhookSecret: await encryptSecret(process.env.BREVO_WEBHOOK_SECRET ?? ''),
        brevoSmsSender: process.env.BREVO_SMS_SENDER ?? '',
      },
      updatedAt: now,
      updatedBy: userId,
    });

    await logAudit({
      ctx,
      userId,
      entityType: 'appConfig',
      entityId: 'setup',
      action: 'create',
      metadata: {
        organizationName: args.organizationName.trim(),
        ssoProviderIds: args.auth.ssoProviders.map((p) => p.providerId),
      },
    });

    return { success: true, adminEmail };
  },
});
