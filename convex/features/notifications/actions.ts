import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { generateEmailHtml, notificationEmail, subjectOf } from '../../auth/emailTemplates';
import { emailBrandOf } from '../../lib/email/brand';
import { isEmailWhitelisted } from '../../lib/shared/devWhitelist';

/** The e-mail channel's delivery: the notification in the system e-mail layout, its button opening the record, through the configured provider. */
export const deliverEmail = internalAction({
  args: { deliveryId: v.id('notificationDeliveries') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runMutation(
      internal.features.notifications.internal.beginNotificationDelivery,
      args,
    );
    if (!job) return null;
    const finish = (result: 'sent' | 'skipped' | 'failed', error?: string) =>
      ctx.runMutation(internal.features.notifications.internal.finishNotificationDelivery, {
        ...args,
        result,
        error,
      });
    // The dev whitelist keeps real people from being e-mailed in dev.
    if (!isEmailWhitelisted(job.to, process.env.DEV_WHITELIST_EMAILS)) {
      await finish('skipped', 'dev_whitelist');
      return null;
    }
    let sent = false;
    try {
      const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
      const brand = await emailBrandOf(ctx, cfg);
      const content = notificationEmail(
        job.title,
        job.body,
        `${brand.appUrl}/settings/notifications`,
      );
      const answer = await ctx.runAction(internal.features.email.actions.sendProviderEmail, {
        to: job.to,
        subject: subjectOf(content, brand),
        htmlContent: generateEmailHtml(content, brand, `${brand.appUrl}${job.path}`),
      });
      sent = answer.ok;
    } catch (error) {
      console.error('[notifications] e-mail delivery failed:', error);
    }
    await finish(sent ? 'sent' : 'failed', sent ? undefined : 'email_send_failed');
    return null;
  },
});
