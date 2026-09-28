'use node';

/** A Node action so that callers outside Node (the Better Auth handler, which cannot import nodemailer) can still send through SMTP. */

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
    const provider = await resolveEmailProvider(cfg);
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

/** Returns the provider's raw response so an admin sees why delivery fails instead of it being lost in logs; it uses the SAVED config. */
export const sendTestEmail = employeeAction({
  args: { to: v.string() },
  handler: async (ctx, args) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const provider = await resolveEmailProvider(cfg);
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
