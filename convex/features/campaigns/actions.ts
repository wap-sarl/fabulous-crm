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
import { sendBrevoSms, toBrevoRecipient } from '../../lib/sms/brevo';
import { createEmailDispatcher } from '../email/send';
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
  handler: async (ctx) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = await resolveBrevo(cfg);
    // Email tracking webhooks only make sense when email goes through Brevo.
    if (!brevo.emailIsBrevo) {
      return { action: 'skipped', reason: 'provider_not_brevo' } as const;
    }
    const apiKey = brevo.apiKey;
    const secret = brevo.webhookSecret;
    const siteUrl = process.env.CONVEX_SITE_URL;
    for (const [name, value] of [
      ['BREVO_API_KEY', apiKey],
      ['BREVO_WEBHOOK_SECRET', secret],
      ['CONVEX_SITE_URL', siteUrl],
    ] as const) {
      if (!value) throw new Error(`Configuration manquante : ${name}`);
    }

    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey!,
    };
    const endpoint = `${siteUrl}/webhooks/brevo/email`;
    const body = JSON.stringify({
      type: 'transactional',
      description: 'WAP CRM — événements e-mail campagnes',
      // The secret goes in a header, never in the URL, where it would sit in proxy logs and in Brevo's webhook listing.
      url: endpoint,
      headers: [{ key: 'x-webhook-secret', value: secret }],
      events: BREVO_EMAIL_WEBHOOK_EVENTS,
    });

    // A re-run updates our webhook (matched by endpoint) instead of stacking duplicates; with none, Brevo answers the error `document_not_found`, not an empty list.
    const listResponse = await fetch('https://api.brevo.com/v3/webhooks?type=transactional', {
      headers,
    });
    const listBody = (await listResponse.json().catch(() => ({}))) as {
      webhooks?: { id: number; url: string }[];
      code?: string;
    };
    if (!listResponse.ok && listBody.code !== 'document_not_found') {
      throw new Error(`Brevo GET /webhooks a échoué : ${JSON.stringify(listBody)}`);
    }
    const existing = listBody.webhooks?.find((w) => w.url.startsWith(endpoint));

    const response = existing
      ? await fetch(`https://api.brevo.com/v3/webhooks/${existing.id}`, {
          method: 'PUT',
          headers,
          body,
        })
      : await fetch('https://api.brevo.com/v3/webhooks', { method: 'POST', headers, body });
    if (!response.ok) {
      throw new Error(
        `Brevo ${existing ? 'PUT' : 'POST'} /webhooks a échoué : ${await response.text()}`,
      );
    }

    const id = existing?.id ?? ((await response.json()) as { id: number }).id;
    return { action: existing ? 'updated' : 'created', id, url: endpoint };
  },
});

/** The per-message `webUrl` never reports inbound replies: this account-level webhook is what makes a STOP reach the CRM. Run once per deployment, safe to run again. */
export const registerBrevoSmsWebhook = internalAction({
  args: {},
  returns: v.object({ action: v.string(), id: v.number(), url: v.string() }),
  handler: async (ctx) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = await resolveBrevo(cfg);
    const apiKey = brevo.apiKey;
    const secret = brevo.webhookSecret;
    const siteUrl = process.env.CONVEX_SITE_URL;
    for (const [name, value] of [
      ['BREVO_API_KEY', apiKey],
      ['BREVO_WEBHOOK_SECRET', secret],
      ['CONVEX_SITE_URL', siteUrl],
    ] as const) {
      if (!value) throw new Error(`Configuration manquante : ${name}`);
    }

    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey!,
    };
    const endpoint = `${siteUrl}/webhooks/brevo/sms`;
    const body = JSON.stringify({
      type: 'transactional',
      channel: 'sms',
      description: 'WAP CRM — événements SMS entrants (STOP, réponses)',
      // An account-level registration can carry a header: only the per-message webUrl (sendCampaignBatch) is stuck with a query secret.
      url: endpoint,
      headers: [{ key: 'x-webhook-secret', value: secret }],
      // Inbound only, the per-message webUrl already reports the outbound ones; these names differ from the payload `msg_status` ("replied", "unsubscribed", "bl") that handleSmsEvent reads.
      events: ['reply', 'unsubscribe', 'blacklisted'],
    });

    // Re-runs update our webhook (matched by endpoint) instead of stacking dupes.
    const listResponse = await fetch(
      'https://api.brevo.com/v3/webhooks?type=transactional&channel=sms',
      { headers },
    );
    const listBody = (await listResponse.json().catch(() => ({}))) as {
      webhooks?: { id: number; url: string }[];
      code?: string;
    };
    if (!listResponse.ok && listBody.code !== 'document_not_found') {
      throw new Error(`Brevo GET /webhooks a échoué : ${JSON.stringify(listBody)}`);
    }
    const existing = listBody.webhooks?.find((w) => w.url.startsWith(endpoint));

    const response = existing
      ? await fetch(`https://api.brevo.com/v3/webhooks/${existing.id}`, {
          method: 'PUT',
          headers,
          body,
        })
      : await fetch('https://api.brevo.com/v3/webhooks', { method: 'POST', headers, body });
    if (!response.ok) {
      throw new Error(
        `Brevo ${existing ? 'PUT' : 'POST'} /webhooks a échoué : ${await response.text()}`,
      );
    }

    const id = existing?.id ?? ((await response.json()) as { id: number }).id;
    return { action: existing ? 'updated' : 'created', id, url: endpoint };
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

    if (!batch || batch.sends.length === 0) {
      await ctx.runMutation(internal.features.campaigns.internal.markCampaignComplete, {
        campaignId: args.campaignId,
      });
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
      // Every pending send is failed, not left in `pending`: the failure shows, and can be retried once the provider is fixed.
      await ctx.runMutation(internal.features.campaigns.internal.failPendingSends, {
        campaignId: args.campaignId,
        error: isSms
          ? 'Compte Brevo non configuré — envoi SMS impossible.'
          : "Fournisseur d'e-mail non configuré — envoi impossible.",
      });
      await ctx.runMutation(internal.features.campaigns.internal.markCampaignComplete, {
        campaignId: args.campaignId,
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
          const subject = renderPlaceholders(batch.subject ?? '', send.params, false);
          const htmlContent = wrapEmailHtml(renderPlaceholders(batch.htmlBody, send.params));
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
      await ctx.runMutation(internal.features.campaigns.internal.markCampaignComplete, {
        campaignId: args.campaignId,
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
