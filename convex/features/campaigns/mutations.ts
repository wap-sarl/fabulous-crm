import { follows, httpUrlSchema, positiveIntSchema } from '../../_lib/validators/fields';
import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { employeeMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import { loadResendContext, requeueSend, requireLinkBase } from '../../lib/campaigns/resend';
import { createAuditFields, updateAuditFields, logAudit } from '../../lib/audit/log';
import {
  resolveEmailProvider,
  resolveBrevo,
  isEmailProviderConfigured,
} from '../../lib/email/provider';
import { loadPropertyDefsById } from '../../lib/properties/definitions';
import {
  campaignChannelValidator,
  campaignTrackedLinkValidator,
  messageTypeValidator,
} from '../../_lib/validators/crm';
import { validateLeadTargetValue } from '../../lib/leads/targets';
import { leadFilterArgs } from '../../lib/leads/tableFilters';
import { requireSendAllowed } from '../../lib/extensions/gates';

const SMS_PROVIDER_REQUIRED = 'Les campagnes SMS nécessitent un compte Brevo configuré.';
const EMAIL_PROVIDER_REQUIRED =
  "Aucun fournisseur d'e-mail n'est configuré. Configurez Brevo ou SMTP dans Paramètres → E-mail.";

// Params injected for every recipient: tracked-link keys may not shadow them.
const RESERVED_PARAM_KEYS = new Set([
  'firstName',
  'lastName',
  'email',
  'phone',
  'status',
  'comment',
  'address',
  'consentUrl',
]);

export const createCampaign = employeeMutation({
  args: {
    name: v.string(),
    channel: campaignChannelValidator,
    // A filter, resolved server-side in batches: an explicit id array would cap recipients at Convex's 8,192-element array limit.
    filter: v.object(leadFilterArgs),
    // Exactly one email mode is provided: brevoTemplateId for a template, subject + htmlBody for a custom email.
    brevoTemplateId: v.optional(v.number()),
    subject: v.optional(v.string()),
    htmlBody: v.optional(v.string()),
    // SMS content.
    smsBody: v.optional(v.string()),
    // Marketing vs transactional; applies to both channels. Default marketing.
    messageType: v.optional(messageTypeValidator),
    // Tracked links authored in the composer (unique per-recipient URLs).
    trackedLinks: v.optional(v.array(campaignTrackedLinkValidator)),
  },
  returns: v.id('campaigns'),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) {
      throw refusal('campaign_name_required', { message: 'Le nom de la campagne est requis.' });
    }

    const messageType = args.messageType ?? 'marketing';

    // Channels and modes the configured provider cannot serve are rejected up front.
    const cfg = await ctx.db.query('appConfig').first();
    const provider = await resolveEmailProvider(cfg);
    const emailProvider = provider.kind;
    const smsAvailable = (await resolveBrevo(cfg)).smsAvailable;

    // Custom-property definitions are substituted as {{ params.custom_<id> }} and referenced by tracked links.
    const defsById = await loadPropertyDefsById(ctx, 'lead');

    // Validate tracked links up front (keys, target field/property, value, redirect).
    const trackedLinks = args.trackedLinks ?? [];
    const linkKeys = new Set<string>();
    for (const link of trackedLinks) {
      if (
        !/^\w+$/.test(link.key) ||
        RESERVED_PARAM_KEYS.has(link.key) ||
        link.key.startsWith('custom_')
      ) {
        throw refusal('tracked_link_key_invalid', {
          message: `Clé de lien de suivi invalide : ${link.key}`,
        });
      }
      if (linkKeys.has(link.key)) {
        throw refusal('tracked_link_key_duplicate', {
          message: `Clé de lien de suivi en double : ${link.key}`,
        });
      }
      linkKeys.add(link.key);

      const valueError = validateLeadTargetValue(link.target, link.value, defsById);
      if (valueError) {
        throw refusal('tracked_link_value_invalid', {
          message: `Lien « ${link.label} » : ${valueError}`,
        });
      }

      if (link.redirectUrl !== undefined && !follows(httpUrlSchema, link.redirectUrl)) {
        throw refusal('tracked_link_redirect_invalid', {
          message: `Lien « ${link.label} » : l'URL de redirection doit commencer par http(s)://`,
        });
      }
    }
    const linkBase = process.env.CONVEX_SITE_URL;
    if (trackedLinks.length > 0 && !linkBase) {
      throw refusal('link_base_missing', {
        message: 'CONVEX_SITE_URL manquant : impossible de générer les liens de suivi.',
      });
    }

    // Resolve and validate the content fields for the chosen channel/mode.
    let brevoTemplateId: number | undefined;
    let subject: string | undefined;
    let htmlBody: string | undefined;
    let smsBody: string | undefined;

    if (args.channel === 'sms') {
      // SMS is Brevo-only, independent of the email provider.
      if (!smsAvailable) {
        throw refusal('sms_provider_required', { message: SMS_PROVIDER_REQUIRED });
      }
      smsBody = args.smsBody?.trim();
      if (!smsBody) {
        throw refusal('sms_body_required', { message: 'Le message SMS est requis.' });
      }
    } else {
      // Without a usable provider (Brevo key or SMTP host) the campaign would silently never send.
      if (!isEmailProviderConfigured(provider)) {
        throw refusal('email_provider_required', { message: EMAIL_PROVIDER_REQUIRED });
      }
      const customHtml = args.htmlBody?.trim();
      if (customHtml) {
        // Custom (WYSIWYG) email: a subject is required.
        subject = args.subject?.trim();
        if (!subject) {
          throw refusal('email_subject_required', { message: 'L’objet de l’e-mail est requis.' });
        }
        htmlBody = customHtml;
      } else {
        // Brevo merges a template server-side, so templates are unavailable under SMTP.
        if (emailProvider === 'smtp') {
          throw refusal('brevo_template_unavailable', {
            message:
              'Les modèles Brevo ne sont pas disponibles en mode SMTP. Utilisez un e-mail personnalisé.',
          });
        }
        // Template email: a positive integer Brevo template id is required.
        if (!follows(positiveIntSchema, args.brevoTemplateId)) {
          throw refusal('brevo_template_invalid', { message: 'ID de template Brevo invalide.' });
        }
        brevoTemplateId = args.brevoTemplateId;
      }
    }

    // Early gate: an exhausted allowance refuses before any recipient is materialised.
    await requireSendAllowed(ctx, {
      source: 'campaign',
      channel: args.channel,
      count: 1,
      stage: 'create',
    });
    const campaignId = await ctx.db.insert('campaigns', {
      name,
      brevoTemplateId,
      subject,
      htmlBody,
      smsBody,
      messageType,
      channel: args.channel,
      // A snapshot, so analytics degrade correctly even if the admin later switches providers.
      emailProvider: args.channel === 'email' ? emailProvider : undefined,
      trackedLinks: trackedLinks.length > 0 ? trackedLinks : undefined,
      status: 'preparing',
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      statsCountedThrough: 'all',
      ...createAuditFields(ctx.userId),
    });

    // Recipients are materialised in scheduled batches: one transaction caps at 8,192 writes, exceeded around 2,000 recipients with 3 tracked links.
    await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.prepareCampaignBatch, {
      campaignId,
      filter: args.filter,
    });

    return campaignId;
  },
});

/** Guards the resends, with the messages of createCampaign: a retry never resets rows into a provider that is silently unconfigured. */
async function assertChannelDeliverable(
  cfg: Doc<'appConfig'> | null,
  channel: 'email' | 'sms',
): Promise<void> {
  if (channel === 'sms') {
    if (!(await resolveBrevo(cfg)).smsAvailable) {
      throw refusal('sms_provider_required', { message: SMS_PROVIDER_REQUIRED });
    }
  } else if (!isEmailProviderConfigured(await resolveEmailProvider(cfg))) {
    throw refusal('email_provider_required', { message: EMAIL_PROVIDER_REQUIRED });
  }
}

/** Resends one recipient whatever its status, except `pending`: that row is already queued. */
export const retryCampaignSend = employeeMutation({
  args: { campaignId: v.id('campaigns'), sendId: v.id('campaignSends') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send || send.campaignId !== args.campaignId) throw refusal('send_not_found');
    if (send.status === 'pending') throw refusal('send_pending');

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw refusal('campaign_not_found');
    // A drain or a resend is already running; its own loop will process pending rows.
    if (campaign.status === 'sending' || campaign.status === 'preparing') {
      throw refusal('campaign_sending');
    }

    const cfg = await ctx.db.query('appConfig').first();
    await assertChannelDeliverable(cfg, campaign.channel ?? 'email');

    const remat = await loadResendContext(ctx, campaign);
    if (!(await requeueSend(ctx, send, remat))) throw refusal('no_contact');
    await requireSendAllowed(ctx, {
      source: 'campaign',
      channel: campaign.channel ?? 'email',
      count: 1,
      stage: 'resend',
    });

    // `sent` was counted in sentCount; `failed` and `skipped_*` in failedCount.
    await ctx.db.patch(args.campaignId, {
      sentCount: Math.max(0, campaign.sentCount - (send.status === 'sent' ? 1 : 0)),
      failedCount: Math.max(0, campaign.failedCount - (send.status === 'sent' ? 0 : 1)),
      status: 'sending',
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAfter(0, internal.features.campaigns.actions.sendCampaignBatch, {
      campaignId: args.campaignId,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: 'resend_send', sendId: args.sendId },
    });
    return null;
  },
});

/** Resends to every recipient, those who already received it included: the sends are re-queued in scheduled batches, the drain follows, and the campaign reads `preparing` meanwhile. The gate is asked here as a preparation with every recipient, so an exhausted allowance refuses at once; the batches ask with what they re-queue, the last one as the resend. */
export const resendAllCampaignSends = employeeMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw refusal('campaign_not_found');
    if (campaign.status === 'sending' || campaign.status === 'preparing') {
      throw refusal('campaign_sending');
    }
    if (campaign.totalCount === 0) return null;

    const cfg = await ctx.db.query('appConfig').first();
    await assertChannelDeliverable(cfg, campaign.channel ?? 'email');
    requireLinkBase(campaign);
    await requireSendAllowed(ctx, {
      source: 'campaign',
      channel: campaign.channel ?? 'email',
      count: campaign.totalCount,
      stage: 'preparing',
    });

    // Counters reset: the batches count the skipped again, the drain what leaves. Links come back with the sends, so the purge sees the campaign again.
    await ctx.db.patch(args.campaignId, {
      sentCount: 0,
      failedCount: 0,
      status: 'preparing',
      failureReason: undefined,
      linksPurgedAt: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.resendCampaignBatch, {
      campaignId: args.campaignId,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: 'resend_all', count: campaign.totalCount },
    });
    return null;
  },
});
