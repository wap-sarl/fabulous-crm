import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { employeeAction } from '../../_lib/auth';
import { refusal } from '../../_lib/refusal';
import { authComponent } from '../../auth';
import { generateEmailHtml, notificationEmail, subjectOf } from '../../auth/emailTemplates';
import { appUrlOf } from '../../lib/config/appUrl';
import { emailBrandOf } from '../../lib/email/brand';
import { channelOf, type SendResult } from '../../lib/notifications/channels';
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

/** The delivery of a channel that is one HTTP call: the notification's text and the link to its record, sent to the person's target by the channel's own `send`. */
export const deliverMessage = internalAction({
  args: { deliveryId: v.id('notificationDeliveries') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runMutation(
      internal.features.notifications.internal.beginNotificationDelivery,
      args,
    );
    if (!job) return null;
    let result: SendResult = 'failed';
    try {
      const send = channelOf(job.channel)?.send;
      const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
      result = send
        ? await send(job.to, {
            title: job.title,
            body: job.body,
            url: `${appUrlOf(cfg)}${job.path}`,
          })
        : 'refused';
    } catch {
      // Nothing of the error is logged: it may quote the person's target.
      console.error(`[notifications] ${job.channel} delivery failed`);
    }
    await ctx.runMutation(internal.features.notifications.internal.finishNotificationDelivery, {
      ...args,
      result: result === 'refused' ? 'skipped' : result,
      error:
        result === 'sent' ? undefined : result === 'refused' ? 'target_refused' : 'send_failed',
    });
    return null;
  },
});

/** « Tester le canal »: one message to the caller's own target on a plugin's channel, and what the service made of it. */
export const testNotificationChannel = employeeAction({
  args: { channel: v.string() },
  returns: v.union(v.literal('sent'), v.literal('refused'), v.literal('failed')),
  handler: async (ctx, args): Promise<SendResult> => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) throw new Error('Unauthorized: employees only');
    const test: { to: string } | 'channel_not_available' | 'no_channel_target' = await ctx.runQuery(
      internal.features.notifications.internal.channelTestOf,
      {
        authId: authUser._id,
        channel: args.channel,
      },
    );
    if (typeof test === 'string') throw refusal(test);
    const send = channelOf(args.channel)?.send;
    if (!send) throw refusal('channel_not_available');
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    return await send(test.to, {
      title: 'Message de test',
      body: `Ce canal fonctionne : vos notifications de ${cfg?.organizationName || 'votre CRM'} arriveront ici.`,
      url: `${appUrlOf(cfg)}/settings/notifications`,
    });
  },
});
