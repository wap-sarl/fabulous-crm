import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import {
  ssoProviderValidator,
  socialProviderConfigValidator,
} from '../_lib/validators/appConfig';
import { logAudit } from '../lib';
import { isSetupComplete } from './helpers';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hexColorRe = /^#[0-9a-fA-F]{6}$/;

/**
 * Pre-auth upload URL for the setup wizard's logo/favicon fields. Guarded by
 * SETUP_TOKEN (like `completeSetup`) so it may run before any user exists; the
 * client POSTs the file to the returned URL and receives a `storageId` which is
 * then passed to `completeSetup`. Refuses once setup is complete.
 */
export const generateSetupUploadUrl = mutation({
  args: { setupToken: v.string() },
  handler: async (ctx, args) => {
    const expected = process.env.SETUP_TOKEN;
    if (!expected) throw new Error('setup_token_not_configured');
    if (args.setupToken !== expected) throw new Error('invalid_setup_token');
    const cfg = await ctx.db.query('appConfig').first();
    if (await isSetupComplete(ctx, cfg)) throw new Error('setup_already_complete');
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * First-run wizard submit. Guarded by SETUP_TOKEN (possession proves control of
 * the deployment), so it may run pre-auth. Creates the config and provisions the
 * first admin (the owner). No session is minted — Better Auth is the session
 * authority, so after setup the owner signs in via /login; their first Better
 * Auth login links `authId` (the gate allows them as an existing employee).
 */
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
  handler: async (ctx, args) => {
    const expected = process.env.SETUP_TOKEN;
    if (!expected) throw new Error('setup_token_not_configured');
    if (args.setupToken !== expected) throw new Error('invalid_setup_token');

    const existingCfg = await ctx.db.query('appConfig').first();
    if (await isSetupComplete(ctx, existingCfg)) {
      throw new Error('setup_already_complete');
    }
    // Extra guard: never write a second config doc.
    if (existingCfg) throw new Error('setup_already_complete');

    const adminEmail = args.admin.email.trim().toLowerCase();
    const senderEmail = args.senderEmail.trim().toLowerCase();
    if (!emailRe.test(adminEmail)) throw new Error('invalid_admin_email');
    if (!emailRe.test(senderEmail)) throw new Error('invalid_sender_email');
    if (!/^https?:\/\//.test(args.appUrl)) throw new Error('invalid_app_url');
    if (args.primaryColor !== undefined && !hexColorRe.test(args.primaryColor)) {
      throw new Error('invalid_primary_color');
    }
    const hasSocial = (args.auth.socialProviders ?? []).some((sp) => sp.enabled);
    const hasSso = args.auth.ssoProviders.some((p) => p.enabled);
    if (!args.auth.magicLinkEnabled && !hasSocial && !hasSso) {
      throw new Error('no_auth_method_enabled');
    }
    // An enabled social provider must carry both credentials.
    for (const sp of args.auth.socialProviders ?? []) {
      if (sp.enabled && (!sp.clientId.trim() || !sp.clientSecret.trim())) {
        throw new Error('social_provider_missing_credentials');
      }
    }
    // An enabled SSO provider must carry an issuer + both credentials.
    for (const p of args.auth.ssoProviders) {
      if (p.enabled && (!p.issuerUrl.trim() || !p.clientId.trim() || !p.clientSecret.trim())) {
        throw new Error('sso_provider_missing_credentials');
      }
    }

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

    await ctx.db.insert('appConfig', {
      setupCompletedAt: now,
      organizationName: args.organizationName.trim(),
      appUrl: args.appUrl.replace(/\/+$/, ''),
      senderEmail,
      senderName: args.senderName.trim(),
      ...(args.logoStorageId && { logoStorageId: args.logoStorageId }),
      ...(args.faviconStorageId && { faviconStorageId: args.faviconStorageId }),
      ...(args.primaryColor && { primaryColor: args.primaryColor.toLowerCase() }),
      auth: args.auth,
      // Default to Brevo with credentials backfilled from env; the settings
      // screen can switch to SMTP later. Resolvers fall back to env regardless.
      email: {
        provider: 'brevo' as const,
        brevoApiKey: process.env.BREVO_API_KEY ?? '',
        brevoWebhookSecret: process.env.BREVO_WEBHOOK_SECRET ?? '',
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
