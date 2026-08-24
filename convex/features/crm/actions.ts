'use node';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import {
  isEmailWhitelisted,
  isEmailProviderConfigured,
  isPhoneWhitelisted,
  renderPlaceholders,
  resolveBrevo,
  resolveEmailProvider,
  sendBrevoSms,
  sendBrevoTemplateEmail,
  toBrevoRecipient,
  wrapEmailHtml,
} from '../../lib';
import { createEmailDispatcher } from '../email/send';
import type { CampaignSendStatus } from '../../schema';

const BATCH_DELAY_MS = 1000;

/**
 * Brevo transactional-email events forwarded to POST /webhooks/brevo/email.
 * `uniqueOpened` is deliberately absent: we subscribe to `opened` (every open)
 * and stamp the send's first-only `openedAt` ourselves — subscribing to both
 * would double-record first opens.
 */
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

/**
 * Register (or update) the account-level Brevo transactional-email webhook
 * pointing at this deployment's /webhooks/brevo/email route. Idempotent — safe
 * to re-run. Run once per deployment:
 *
 *   bunx convex run features/crm/actions:registerBrevoEmailWebhook          # dev
 *   bunx convex run features/crm/actions:registerBrevoEmailWebhook --prod   # prod
 */
export const registerBrevoEmailWebhook = internalAction({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = resolveBrevo(cfg);
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
      // Secret in a registration-time header, never in the URL where it
      // would sit in proxy logs and Brevo's webhook listing.
      url: endpoint,
      headers: [{ key: 'x-webhook-secret', value: secret }],
      events: BREVO_EMAIL_WEBHOOK_EVENTS,
    });

    // Look for an existing webhook of ours (same endpoint, any secret) so
    // re-runs update it instead of stacking duplicates. Brevo answers an error
    // with code `document_not_found` instead of an empty list when none exist.
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

/**
 * Register (or update) the account-level Brevo transactional-SMS webhook pointing
 * at this deployment's /webhooks/brevo/sms route, so an inbound STOP fires an
 * `unsubscribed` event that revokes the lead's SMS consent (handleSmsEvent). The
 * per-message `webUrl` only reports outbound delivery, never inbound replies, so
 * this account-level webhook is what makes STOP opt-outs reach the CRM. Idempotent;
 * run once per deployment:
 *
 *   bunx convex run features/crm/actions:registerBrevoSmsWebhook          # dev
 *   bunx convex run features/crm/actions:registerBrevoSmsWebhook --prod   # prod
 */
export const registerBrevoSmsWebhook = internalAction({
  args: {},
  handler: async (ctx) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = resolveBrevo(cfg);
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
      // Account-level registration can carry a header — only the
      // per-message webUrl (sendCampaignBatch) is stuck with a query secret.
      url: endpoint,
      headers: [{ key: 'x-webhook-secret', value: secret }],
      // Inbound-only events. The per-message webUrl already delivers the OUTBOUND
      // lifecycle (delivered, bounces), so subscribing to those here would
      // double-record them. NB: Brevo's SMS *registration* strings differ from the
      // webhook *payload* `msg_status` (verified against the API):
      //   reply → payload "replied", unsubscribe → "unsubscribed", blacklisted → "bl".
      // handleSmsEvent keys off the payload values.
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

/**
 * Send one batch of a campaign's pending emails via a Brevo template, record
 * the results, then reschedule itself until the queue is drained. Runs as a
 * node action so it can call the Brevo HTTP API.
 */
export const sendCampaignBatch = internalAction({
  args: { campaignId: v.id('campaigns') },
  handler: async (ctx, args) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const provider = resolveEmailProvider(cfg);
    const brevo = resolveBrevo(cfg);

    const batch = await ctx.runQuery(internal.features.crm.internal.getPendingSends, {
      campaignId: args.campaignId,
    });

    if (!batch || batch.sends.length === 0) {
      await ctx.runMutation(internal.features.crm.internal.markCampaignComplete, {
        campaignId: args.campaignId,
      });
      return;
    }

    const isSms = batch.channel === 'sms';

    // Fail fast when the active provider can't serve this channel: SMS needs a
    // Brevo key; Brevo email needs an API key; SMTP email needs a host. Same
    // shape as the legacy missing-key guard — mark complete and stop.
    const cannotSend =
      (isSms && !brevo.smsAvailable) || (!isSms && !isEmailProviderConfigured(provider));
    if (cannotSend) {
      console.error(
        isSms
          ? 'SMS campaign but no Brevo API key configured — cannot send'
          : 'Email provider not configured — cannot send campaign',
      );
      // Surface the failure on every pending send (instead of orphaning them in
      // `pending`) so it's visible and retry-able once the provider is fixed.
      await ctx.runMutation(internal.features.crm.internal.failPendingSends, {
        campaignId: args.campaignId,
        error: isSms
          ? 'Compte Brevo non configuré — envoi SMS impossible.'
          : "Fournisseur d'e-mail non configuré — envoi impossible.",
      });
      await ctx.runMutation(internal.features.crm.internal.markCampaignComplete, {
        campaignId: args.campaignId,
      });
      return;
    }

    const results: {
      sendId: (typeof batch.sends)[number]['sendId'];
      status: CampaignSendStatus;
      brevoMessageId?: string;
      error?: string;
    }[] = [];

    // Per-message webhook so Brevo notifies us of SMS events (STOP opt-outs).
    // Brevo's per-message webhooks cannot send headers, so this is the one
    // path where a secret travels in the URL — the DEDICATED SMS secret,
    // so its exposure never burns the account-level one. Without a secret the
    // feature is off and no webUrl is sent.
    const smsWebhookUrl =
      isSms && brevo.smsWebhookSecret && process.env.CONVEX_SITE_URL
        ? `${process.env.CONVEX_SITE_URL}/webhooks/brevo/sms?secret=${brevo.smsWebhookSecret}`
        : undefined;

    // Pooled email dispatcher (Brevo API or SMTP) — only for custom-HTML email
    // campaigns; SMS and Brevo-template paths don't use it. Closed after the loop.
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

        // Custom (WYSIWYG) email: send the authored HTML with placeholders
        // substituted per recipient, via the active provider (Brevo API or SMTP).
        // Otherwise use the Brevo template path.
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

        // Brevo template merge happens server-side at Brevo — unavailable over
        // SMTP. Only reachable if the provider was switched to SMTP mid-send
        // (createCampaign blocks template campaigns when the provider is SMTP).
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
      // A fatal error mid-drain would otherwise leave the campaign stuck in
      // `sending` forever. Persist what we have, fail the rest so it surfaces and
      // stays retry-able, and finalize without rescheduling.
      console.error('Campaign send batch crashed:', err);
      if (results.length > 0) {
        await ctx.runMutation(internal.features.crm.internal.recordSendResults, {
          campaignId: args.campaignId,
          results,
        });
      }
      await ctx.runMutation(internal.features.crm.internal.failPendingSends, {
        campaignId: args.campaignId,
        error: "Erreur lors de l'envoi — réessayez.",
      });
      await ctx.runMutation(internal.features.crm.internal.markCampaignComplete, {
        campaignId: args.campaignId,
      });
      return;
    } finally {
      dispatcher?.close();
    }

    await ctx.runMutation(internal.features.crm.internal.recordSendResults, {
      campaignId: args.campaignId,
      results,
    });

    // Reschedule for the next batch; markCampaignComplete fires when drained.
    await ctx.scheduler.runAfter(BATCH_DELAY_MS, internal.features.crm.actions.sendCampaignBatch, {
      campaignId: args.campaignId,
    });
  },
});
