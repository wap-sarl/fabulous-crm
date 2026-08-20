import { internalMutation } from '../_generated/server';
import { appOrigin } from '../lib';

/**
 * One-shot migration for deployments that predate the config/SSO feature. If
 * there is no config doc yet but users exist, create a config marked
 * setup-complete (magic link on, no SSO) and promote all existing employees to
 * admin so nobody is locked out. Idempotent — safe to run more than once.
 *
 *   bunx convex run seed/bootstrapConfig:bootstrapExistingDeployment
 */
export const bootstrapExistingDeployment = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query('appConfig').first();
    if (existing) return { created: false, reason: 'config_exists' };

    const users = await ctx.db.query('users').collect();
    if (users.length === 0) return { created: false, reason: 'no_users' };

    const now = Date.now();
    await ctx.db.insert('appConfig', {
      setupCompletedAt: now,
      organizationName: 'CRM',
      appUrl: appOrigin(),
      senderEmail: process.env.EMAIL_SENDER_EMAIL ?? '',
      senderName: process.env.EMAIL_SENDER_NAME ?? 'CRM',
      auth: { magicLinkEnabled: true, ssoProviders: [], socialProviders: [] },
      email: {
        provider: 'brevo',
        brevoApiKey: process.env.BREVO_API_KEY ?? '',
        brevoWebhookSecret: process.env.BREVO_WEBHOOK_SECRET ?? '',
        brevoSmsSender: process.env.BREVO_SMS_SENDER ?? '',
      },
      updatedAt: now,
    });

    let promoted = 0;
    for (const u of users) {
      if (u.type === 'employee' && u.role !== 'admin') {
        await ctx.db.patch(u._id, { role: 'admin' });
        promoted++;
      }
    }

    return { created: true, promoted };
  },
});

/**
 * Backfill the `email` sub-object onto an existing config doc that predates the
 * configurable-provider feature (the common case — most deployments already have
 * a config doc from the SSO feature). Copies the current Brevo env vars in so the
 * settings screen shows real values; readers already fall back to env when
 * absent, so this is convenience, not correctness. Idempotent.
 *
 *   bunx convex run seed/bootstrapConfig:backfillEmailConfig
 */
export const backfillEmailConfig = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.db.query('appConfig').first();
    if (!cfg) return { patched: false, reason: 'no_config' };
    if (cfg.email) return { patched: false, reason: 'already_set' };
    await ctx.db.patch(cfg._id, {
      email: {
        provider: 'brevo',
        brevoApiKey: process.env.BREVO_API_KEY ?? '',
        brevoWebhookSecret: process.env.BREVO_WEBHOOK_SECRET ?? '',
        brevoSmsSender: process.env.BREVO_SMS_SENDER ?? '',
      },
    });
    return { patched: true };
  },
});
