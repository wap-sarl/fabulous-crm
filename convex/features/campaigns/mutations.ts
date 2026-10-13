import { follows, positiveIntSchema } from '../../_lib/validators/fields';
import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import { employeeMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import { checkTrackedLinks } from '../../lib/campaigns/links';
import { loadResendContext, requeueSend, requireLinkBase } from '../../lib/campaigns/resend';
import { createAuditFields, updateAuditFields, logAudit } from '../../lib/audit/log';
import { loadEmailTemplate } from '../../lib/templates/records';
import {
  assertChannelDeliverable,
  EMAIL_PROVIDER_REQUIRED,
  isEmailProviderConfigured,
  resolveBrevo,
  resolveEmailProvider,
  SMS_PROVIDER_REQUIRED,
} from '../../lib/email/provider';
import { scheduleDrain } from '../../lib/campaigns/drain';
import { loadPropertyDefsById } from '../../lib/properties/definitions';
import {
  campaignChannelValidator,
  campaignTrackedLinkValidator,
  messageTypeValidator,
} from '../../_lib/validators/crm';
import { leadFilterArgs } from '../../lib/leads/tableFilters';
import { requireSendAllowed } from '../../lib/extensions/gates';
import {
  cancelStart,
  checkScheduledAt,
  scheduleStart,
  startCampaign,
} from '../../lib/campaigns/schedule';
import { abTestArgs, checkAbTest } from '../../lib/campaigns/variants';

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
    // The subscription a marketing campaign writes under: only the contacts in on it receive it.
    subscriptionTypeId: v.optional(v.id('subscriptionTypes')),
    // The CRM template the e-mail was loaded from, one in the caller's reach; the content travels in subject and htmlBody.
    templateId: v.optional(v.id('emailTemplates')),
    // Tracked links authored in the composer (unique per-recipient URLs).
    trackedLinks: v.optional(v.array(campaignTrackedLinkValidator)),
    // Later than now: the campaign waits for that time instead of starting at once.
    scheduledAt: v.optional(v.number()),
    // Each e-mail at the hour its recipient opens most, within the day that follows the start.
    sendTimeOptimized: v.optional(v.boolean()),
    abTest: v.optional(abTestArgs),
  },
  returns: v.id('campaigns'),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) {
      throw refusal('campaign_name_required', { message: 'Le nom de la campagne est requis.' });
    }

    const messageType = args.messageType ?? 'marketing';
    if (args.scheduledAt !== undefined) checkScheduledAt(args.scheduledAt);
    if (args.templateId) await loadEmailTemplate(ctx, args.templateId);
    const subscriptionType = args.subscriptionTypeId
      ? await ctx.db.get(args.subscriptionTypeId)
      : null;
    if (args.subscriptionTypeId && !subscriptionType?.active) {
      throw refusal('subscription_type_not_found');
    }
    if (subscriptionType && subscriptionType.channel !== args.channel) {
      throw refusal('subscription_channel_mismatch');
    }

    // Channels and modes the configured provider cannot serve are rejected up front.
    const cfg = await ctx.db.query('appConfig').first();
    const provider = await resolveEmailProvider(cfg);
    const emailProvider = provider.kind;
    const smsAvailable = (await resolveBrevo(cfg)).smsAvailable;

    // Custom-property definitions are substituted as {{ params.custom_<id> }} and referenced by tracked links.
    const defsById = await loadPropertyDefsById(ctx, 'lead');

    const trackedLinks = checkTrackedLinks(args.trackedLinks ?? [], defsById);
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

    const abTest = args.abTest ? checkAbTest(args.abTest, htmlBody) : undefined;

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
      subscriptionTypeId: messageType === 'marketing' ? args.subscriptionTypeId : undefined,
      templateId: args.channel === 'email' ? args.templateId : undefined,
      channel: args.channel,
      // A snapshot, so analytics degrade correctly even if the admin later switches providers.
      emailProvider: args.channel === 'email' ? emailProvider : undefined,
      trackedLinks: trackedLinks.length > 0 ? trackedLinks : undefined,
      // Kept for a scheduled start, and for a start by hand after a cancellation.
      filter: args.filter,
      sendTimeOptimized: args.channel === 'email' && args.sendTimeOptimized ? true : undefined,
      abTest,
      status: 'draft',
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      statsCountedThrough: 'all',
      ...createAuditFields(ctx.userId),
    });
    const campaign = (await ctx.db.get(campaignId))!;

    // Recipients are materialised in scheduled batches: one transaction caps at 8,192 writes, exceeded around 2,000 recipients with 3 tracked links.
    if (args.scheduledAt !== undefined) await scheduleStart(ctx, campaign, args.scheduledAt);
    else await startCampaign(ctx, campaign);

    return campaignId;
  },
});

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

    // `sent` was counted in sentCount; `failed` and `skipped_*` in failedCount; a cancelled send in neither.
    const wasCounted = send.status === 'failed' || send.status.startsWith('skipped_');
    await ctx.db.patch(args.campaignId, {
      sentCount: Math.max(0, campaign.sentCount - (send.status === 'sent' ? 1 : 0)),
      failedCount: Math.max(0, campaign.failedCount - (wasCounted ? 1 : 0)),
      status: 'sending',
      ...updateAuditFields(ctx.userId),
    });
    await scheduleDrain(ctx, args.campaignId, Date.now());

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

/** A campaign that waits, or was taken off the schedule, gets a new time; `null` starts it now. */
export const scheduleCampaign = employeeMutation({
  args: { campaignId: v.id('campaigns'), scheduledAt: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.deletedAt != null) throw refusal('campaign_not_found');
    if (campaign.status !== 'scheduled' && campaign.status !== 'draft') {
      throw refusal('campaign_not_schedulable');
    }
    if (args.scheduledAt === null) {
      await cancelStart(ctx, campaign);
      await ctx.db.patch(args.campaignId, {
        scheduledAt: undefined,
        ...updateAuditFields(ctx.userId),
      });
      await startCampaign(ctx, campaign);
    } else {
      checkScheduledAt(args.scheduledAt);
      await scheduleStart(ctx, campaign, args.scheduledAt);
      await ctx.db.patch(args.campaignId, updateAuditFields(ctx.userId));
    }
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata:
        args.scheduledAt === null
          ? { event: 'started' }
          : { event: 'scheduled', scheduledAt: args.scheduledAt },
    });
    return null;
  },
});

/** « Annuler l'envoi »: the campaign leaves the schedule and waits as a draft, its recipients still unresolved. */
export const cancelScheduledCampaign = employeeMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.deletedAt != null) throw refusal('campaign_not_found');
    if (campaign.status !== 'scheduled') throw refusal('campaign_not_scheduled');
    await cancelStart(ctx, campaign);
    await ctx.db.patch(args.campaignId, {
      status: 'draft',
      scheduledAt: undefined,
      scheduledFnId: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: 'schedule_cancelled' },
    });
    return null;
  },
});

/** « Arrêter l'envoi »: nothing more leaves. The sends still queued are cancelled a page at a time, and show as such; « Tout renvoyer » or a retry re-queues them. */
export const stopCampaignSending = employeeMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.deletedAt != null) throw refusal('campaign_not_found');
    if (campaign.status !== 'sending' && campaign.status !== 'preparing') {
      throw refusal('campaign_not_sending');
    }
    // The preparation and the drain both read the status first: the chains end on their own.
    await ctx.db.patch(args.campaignId, {
      status: 'stopped',
      drainFnId: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.cancelPendingSends, {
      campaignId: args.campaignId,
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: 'stopped', sentCount: campaign.sentCount },
    });
    return null;
  },
});
