'use node';

/** A Node action so that callers outside Node (the Better Auth handler, which cannot import nodemailer) can still send through SMTP. */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { employeeAction } from '../../_lib/auth';
import { TEST_EMAIL, generateEmailHtml } from '../../auth/emailTemplates';
import { emailBrandOf } from '../../lib/email/brand';
import { resolveEmailProvider } from '../../lib/email/provider';
import { sendEmail } from './send';

export const sendProviderEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    htmlContent: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
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
  returns: v.object({
    to: v.string(),
    provider: v.union(v.literal('brevo'), v.literal('smtp')),
    from: v.object({ name: v.string(), email: v.string() }),
    ok: v.boolean(),
    status: v.number(),
    error: v.optional(v.string()),
    messageId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const provider = await resolveEmailProvider(cfg);
    const result = await sendEmail(provider, {
      to: [{ email: args.to }],
      subject: TEST_EMAIL.subject,
      htmlContent: generateEmailHtml(TEST_EMAIL, await emailBrandOf(ctx, cfg)),
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
