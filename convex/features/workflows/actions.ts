'use node';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import {
  isEmailProviderConfigured,
  isEmailWhitelisted,
  isPhoneWhitelisted,
  renderPlaceholders,
  resolveBrevo,
  resolveEmailProvider,
  sendBrevoSms,
  toBrevoRecipient,
  wrapEmailHtml,
} from '../../lib';
import { sendEmail } from '../email/send';
import type { WorkflowStepOutcome } from '../../_lib/validators/workflows';
import { WEBHOOK_TIMEOUT_MS } from './lib';

/**
 * Async executor of a workflow send/webhook step. Dumb by design: every
 * decision (consent, presence, ordering) was made in `executeStep`; this only
 * performs the external call and reports the outcome. Always ends with exactly
 * one `completeActionStep`, which advances the run.
 */
export const runWorkflowActionStep = internalAction({
  args: { runId: v.id('workflowRuns'), stepId: v.id('workflowRunSteps'), nodeId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const complete = (status: WorkflowStepOutcome, detail?: string) =>
      ctx.runMutation(internal.features.workflows.internal.completeActionStep, {
        ...args,
        status,
        detail,
      });

    try {
      const step = await ctx.runQuery(internal.features.workflows.internal.getActionStepContext, args);
      if (!step) {
        await complete('skipped', 'contexte indisponible');
        return;
      }
      const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);

      if (step.kind === 'email') {
        const provider = resolveEmailProvider(cfg);
        if (!isEmailProviderConfigured(provider)) {
          await complete('failed', "Fournisseur d'e-mail non configuré — envoi impossible.");
          return;
        }
        // In dev, only whitelisted addresses are actually contacted.
        if (!isEmailWhitelisted(step.to, process.env.DEV_WHITELIST_EMAILS)) {
          await complete('success', 'dev_whitelist_skip');
          return;
        }
        const result = await sendEmail(provider, {
          to: [{ email: step.to }],
          subject: renderPlaceholders(step.subject, step.params, false),
          htmlContent: wrapEmailHtml(renderPlaceholders(step.htmlBody, step.params)),
        });
        await complete(result.ok ? 'success' : 'failed', result.ok ? undefined : result.error);
        return;
      }

      if (step.kind === 'sms') {
        const brevo = resolveBrevo(cfg);
        if (!brevo.smsAvailable) {
          await complete('failed', 'Compte Brevo non configuré — envoi SMS impossible.');
          return;
        }
        const recipient = toBrevoRecipient(step.phone);
        if (!recipient) {
          await complete('failed', `Numéro de téléphone invalide : ${step.phone}`);
          return;
        }
        if (!isPhoneWhitelisted(step.phone, process.env.DEV_WHITELIST_PHONES)) {
          await complete('success', 'dev_whitelist_skip');
          return;
        }
        const result = await sendBrevoSms(brevo.apiKey, {
          recipient,
          content: renderPlaceholders(step.smsBody, step.params, false),
          type: 'marketing',
          sender: brevo.smsSender,
        });
        await complete(result.ok ? 'success' : 'failed', result.ok ? undefined : result.error);
        return;
      }

      // webhook
      const response = await fetch(step.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(step.payload),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      await complete(response.ok ? 'success' : 'failed', `HTTP ${response.status}`);
    } catch (error) {
      console.error('workflow action step crashed', error);
      await complete('failed', error instanceof Error ? error.message : 'erreur inconnue');
    }
  },
});
