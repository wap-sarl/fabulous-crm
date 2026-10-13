'use node';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { isEmailWhitelisted, isPhoneWhitelisted } from '../../lib/shared/devWhitelist';
import {
  isEmailProviderConfigured,
  resolveBrevo,
  resolveEmailProvider,
} from '../../lib/email/provider';
import { renderPlaceholders, sendBrevoTemplateEmail, wrapEmailHtml } from '../../lib/email/brevo';
import { registerBrevoWebhook } from '../../lib/email/brevoWebhooks';
import { sendBrevoSms, toBrevoRecipient } from '../../lib/sms/brevo';
import { createEmailDispatcher } from '../email/send';
import { variantContent } from '../../lib/campaigns/variants';
import type { CampaignSendStatus } from '../../schema';
import { deferUnlessAllowed } from '../../lib/extensions/gates';

const BATCH_DELAY_MS = 1000;

/** `uniqueOpened` is left out on purpose: `opened` reports every open and the send's first-only `openedAt` is stamped here, both would record a first open twice. */
const BREVO_EMAIL_WEBHOOK_EVENTS = [
  'delivered',
  'opened',
  'click',
  'hardBounce',
  'softBounce',
  'spam',
  'unsubscribed',
  'blocked',
  'invalid',
  'error',
];

/** Registers the account-level Brevo email webhook for this deployment: run once per deployment, and safe to run again. */
export const registerBrevoEmailWebhook = internalAction({
  args: {},
  returns: v.union(
    v.object({ action: v.literal('skipped'), reason: v.literal('provider_not_brevo') }),
    v.object({ action: v.string(), id: v.number(), url: v.string() }),
  ),
  // Spelled out: inferred through the helper, the type would loop back through the generated api.
  handler: async (
    ctx,
  ): Promise<
    | { action: 'skipped'; reason: 'provider_not_brevo' }
    | { action: string; id: number; url: string }
  > => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = await resolveBrevo(cfg);
    // Email tracking webhooks only make sense when email goes through Brevo.
    if (!brevo.emailIsBrevo) {
      return { action: 'skipped', reason: 'provider_not_brevo' } as const;
    }
    return await registerBrevoWebhook(brevo, {
      path: '/webhooks/brevo/email',
      description: 'Fabulous CRM — événements e-mail campagnes',
      events: BREVO_EMAIL_WEBHOOK_EVENTS,
    });
  },
});

/** The per-message `webUrl` never reports inbound replies: this account-level webhook is what makes a STOP reach the CRM. Run once per deployment, safe to run again. */
export const registerBrevoSmsWebhook = internalAction({
  args: {},
  returns: v.object({ action: v.string(), id: v.number(), url: v.string() }),
  handler: async (ctx): Promise<{ action: string; id: number; url: string }> => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    return await registerBrevoWebhook(await resolveBrevo(cfg), {
      path: '/webhooks/brevo/sms',
      channel: 'sms',
      description: 'Fabulous CRM — événements SMS entrants (STOP, réponses)',
      // Inbound only, the per-message webUrl already reports the outbound ones; these names differ from the payload `msg_status` ("replied", "unsubscribed", "bl") that handleSmsEvent reads.
      events: ['reply', 'unsubscribe', 'blacklisted'],
    });
  },
});

/** Sends one batch of a campaign's pending sends, then reschedules itself until none is left. */
export const sendCampaignBatch = internalAction({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Deferred (e.g. a suspended deployment): the pending sends wait untouched for the next attempt.
    if (
      await deferUnlessAllowed(
        ctx,
        'campaign_drain',
        internal.features.campaigns.actions.sendCampaignBatch,
        args,
      )
    ) {
      return null;
    }
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const provider = await resolveEmailProvider(cfg);
    const brevo = await resolveBrevo(cfg);

    const batch = await ctx.runQuery(internal.features.campaigns.internal.getPendingSends, {
      campaignId: args.campaignId,
    });

    // Nothing due yet: the drain sleeps until the next send's time.
    if (batch && batch.sends.length === 0 && batch.nextAt !== undefined) {
      await ctx.scheduler.runAt(
        batch.nextAt,
        internal.features.campaigns.actions.sendCampaignBatch,
        args,
      );
      return null;
    }
    if (!batch || batch.sends.length === 0) {
      await ctx.runMutation(internal.features.campaigns.internal.markCampaignComplete, {
        campaignId: args.campaignId,
      });
      return null;
    }
    // The holdout is due and the test undecided: decided first, the batch is read again with the winner.
    if (batch.winnerPending) {
      await ctx.runMutation(internal.features.campaigns.internal.decideAbWinner, {
        campaignId: args.campaignId,
      });
      await ctx.scheduler.runAfter(0, internal.features.campaigns.actions.sendCampaignBatch, args);
      return null;
    }

    const isSms = batch.channel === 'sms';

    // The active provider must be able to serve the channel: SMS and Brevo email need an API key, SMTP email needs a host.
    const cannotSend =
      (isSms && !brevo.smsAvailable) || (!isSms && !isEmailProviderConfigured(provider));
    if (cannotSend) {
      console.error(
        isSms
          ? 'SMS campaign but no Brevo API key configured — cannot send'
          : 'Email provider not configured — cannot send campaign',
      );
      // Every pending send is failed, not left in `pending`: the failure shows, and can be retried once the provider is fixed; the campaign completes with the last batch.
      await ctx.runMutation(internal.features.campaigns.internal.failPendingSends, {
        campaignId: args.campaignId,
        error: isSms
          ? 'Compte Brevo non configuré — envoi SMS impossible.'
          : "Fournisseur d'e-mail non configuré — envoi impossible.",
      });
      return null;
    }

    const results: {
      sendId: (typeof batch.sends)[number]['sendId'];
      status: CampaignSendStatus;
      brevoMessageId?: string;
      error?: string;
    }[] = [];

    // Brevo's per-message webhooks cannot send headers, so the secret travels in the URL: the dedicated SMS one, whose exposure never burns the account-level one. No secret, no webUrl.
    const smsWebhookUrl =
      isSms && brevo.smsWebhookSecret && process.env.CONVEX_SITE_URL
        ? `${process.env.CONVEX_SITE_URL}/webhooks/brevo/sms?secret=${brevo.smsWebhookSecret}`
        : undefined;

    // Pooled, and only for custom-HTML email campaigns: the SMS and Brevo-template paths do not use it.
    const dispatcher = !isSms && batch.htmlBody ? createEmailDispatcher(provider) : null;

    try {
      for (const send of batch.sends) {
        if (isSms) {
          if (!send.phone) {
            results.push({ sendId: send.sendId, status: 'skipped_no_phone' });
            continue;
          }

          const recipient = toBrevoRecipient(send.phone);
          if (!recipient) {
            results.push({
              sendId: send.sendId,
              status: 'failed',
              error: `Numéro de téléphone invalide : ${send.phone}`,
            });
            continue;
          }

          // In dev, only whitelisted numbers are actually contacted.
          if (!isPhoneWhitelisted(send.phone, process.env.DEV_WHITELIST_PHONES)) {
            results.push({
              sendId: send.sendId,
              status: 'sent',
              brevoMessageId: 'dev_whitelist_skip',
            });
            continue;
          }

          const content = renderPlaceholders(batch.smsBody ?? '', send.params, false);
          const result = await sendBrevoSms(brevo.apiKey, {
            recipient,
            content,
            type: batch.messageType ?? 'marketing',
            sender: brevo.smsSender,
            webUrl: smsWebhookUrl,
          });
          results.push({
            sendId: send.sendId,
            status: result.ok ? 'sent' : 'failed',
            brevoMessageId: result.messageId,
            error: result.ok ? undefined : result.error,
          });
          continue;
        }

        if (!send.email) {
          results.push({ sendId: send.sendId, status: 'skipped_no_email' });
          continue;
        }

        // In dev, only whitelisted addresses are actually contacted.
        if (!isEmailWhitelisted(send.email, process.env.DEV_WHITELIST_EMAILS)) {
          results.push({
            sendId: send.sendId,
            status: 'sent',
            brevoMessageId: 'dev_whitelist_skip',
          });
          continue;
        }

        // A custom (WYSIWYG) email goes through the active provider; without an HTML body, the Brevo template path below applies.
        if (batch.htmlBody) {
          // The variant the send tests, or the winner for the holdout.
          const content = variantContent(batch, send.variant ?? batch.abTest?.winner);
          const subject = renderPlaceholders(content.subject ?? '', send.params, false);
          const htmlContent = wrapEmailHtml(
            renderPlaceholders(content.htmlBody ?? batch.htmlBody, send.params),
          );
          const result = await dispatcher!.send({
            to: [{ email: send.email }],
            subject,
            htmlContent,
          });
          results.push({
            sendId: send.sendId,
            status: result.ok ? 'sent' : 'failed',
            brevoMessageId: result.messageId,
            error: result.ok ? undefined : result.error,
          });
          continue;
        }

        if (batch.brevoTemplateId === undefined) {
          results.push({
            sendId: send.sendId,
            status: 'failed',
            error: 'Campaign has neither a Brevo template id nor a custom HTML body',
          });
          continue;
        }

        // Brevo merges its templates on its side, so none over SMTP: reached only when the provider was switched mid-send, createCampaign blocks the rest.
        if (provider.kind !== 'brevo') {
          results.push({
            sendId: send.sendId,
            status: 'failed',
            error: 'Les modèles Brevo ne sont pas disponibles en mode SMTP.',
          });
          continue;
        }

        const result = await sendBrevoTemplateEmail(provider.apiKey, {
          to: [{ email: send.email }],
          templateId: batch.brevoTemplateId,
          params: send.params,
        });

        results.push({
          sendId: send.sendId,
          status: result.ok ? 'sent' : 'failed',
          brevoMessageId: result.messageId,
          error: result.ok ? undefined : result.error,
        });
      }
    } catch (err) {
      // A fatal error mid-drain would leave the campaign in `sending` forever: what was sent is recorded, the rest is failed so it can be retried.
      console.error('Campaign send batch crashed:', err);
      if (results.length > 0) {
        await ctx.runMutation(internal.features.campaigns.internal.recordSendResults, {
          campaignId: args.campaignId,
          results,
        });
      }
      await ctx.runMutation(internal.features.campaigns.internal.failPendingSends, {
        campaignId: args.campaignId,
        error: "Erreur lors de l'envoi — réessayez.",
      });
      return null;
    } finally {
      dispatcher?.close();
    }

    await ctx.runMutation(internal.features.campaigns.internal.recordSendResults, {
      campaignId: args.campaignId,
      results,
    });

    // Reschedule for the next batch; markCampaignComplete fires when drained.
    await ctx.scheduler.runAfter(
      BATCH_DELAY_MS,
      internal.features.campaigns.actions.sendCampaignBatch,
      {
        campaignId: args.campaignId,
      },
    );
    return null;
  },
});
