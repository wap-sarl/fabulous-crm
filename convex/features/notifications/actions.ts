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
    const send = channelOf(job.channel)?.send;
    let result: SendResult | 'skipped' = send ? 'failed' : 'skipped';
    try {
      // A `send` never throws, it answers `failed`: only this read can, and it is then an attempt that failed.
      const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
      if (send) {
        result = await send(job.to, {
          title: job.title,
          body: job.body,
          url: `${appUrlOf(cfg)}${job.path}`,
        });
      }
    } catch (error) {
      console.error('[notifications] the configuration could not be read for a delivery:', error);
    }
    const errors = { failed: 'send_failed', skipped: 'channel_cannot_send' } as const;
    await ctx.runMutation(internal.features.notifications.internal.finishNotificationDelivery, {
      ...args,
      result,
      error: result === 'failed' || result === 'skipped' ? errors[result] : undefined,
      target: job.target,
    });
    return null;
  },
});

/** Why a channel has no test to send, as the refusal's code. */
type NoChannelTest = 'channel_not_available' | 'no_channel_target' | 'channel_target_unreadable';

/** « Tester le canal »: one message to the caller's own target on a plugin's channel, and what the service made of it; for any employee, the target is their own. */
export const testNotificationChannel = employeeAction({
  args: { channel: v.string() },
  returns: v.union(
    v.literal('sent'),
    v.literal('refused'),
    v.literal('failed'),
    v.literal('rate_limited'),
  ),
  handler: async (ctx, args): Promise<'sent' | 'refused' | 'failed' | 'rate_limited'> => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) throw new Error('Unauthorized: employees only');
    const test: { to: string } | NoChannelTest = await ctx.runQuery(
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
    const answer: SendResult = await send(test.to, {
      title: 'Message de test',
      body: `Ce canal fonctionne : vos notifications de ${cfg?.organizationName || 'votre CRM'} arriveront ici.`,
      url: `${appUrlOf(cfg)}/settings/notifications`,
    });
    // A test is not retried: a service asking to wait did not take it, and the page says why.
    return typeof answer === 'string' ? answer : 'rate_limited';
  },
});
