'use node';

/**
 * Node action that sends a single transactional email through the active
 * provider. Exists so non-node callers (the Better Auth request handler in
 * auth.ts, which cannot import nodemailer) can send via SMTP by scheduling /
 * running this action.
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { employeeAction } from '../../_lib/auth';
import { resolveEmailProvider } from '../../lib';
import { sendEmail } from './send';

export const sendProviderEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    htmlContent: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const provider = resolveEmailProvider(cfg);
    const result = await sendEmail(provider, {
      to: [{ email: args.to }],
      subject: args.subject,
      htmlContent: args.htmlContent,
    });
    if (!result.ok) {
      console.error('sendProviderEmail failed:', result.error);
    }
    return { ok: result.ok };
  },
});

/**
 * Diagnostic: send a real test email through the currently-SAVED provider and
 * return the provider's actual response (status + raw error body + the resolved
 * `From`) to the caller — so an admin can see exactly why delivery fails
 * (unverified sender, bad key, etc.) instead of it being swallowed into logs.
 * Uses the persisted config, so save the settings first.
 */
export const sendTestEmail = employeeAction({
  args: { to: v.string() },
  handler: async (ctx, args) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const provider = resolveEmailProvider(cfg);
    const result = await sendEmail(provider, {
      to: [{ email: args.to }],
      subject: '[CRM] E-mail de test',
      htmlContent:
        '<p>Ceci est un e-mail de test du CRM. Si vous le recevez, l’envoi d’e-mails fonctionne.</p>',
    });
    return {
      to: args.to,
      provider: provider.kind,
      from: provider.sender,
      ok: result.ok,
      status: result.status,
      error: result.error,
      messageId: result.messageId,
    };
  },
});
