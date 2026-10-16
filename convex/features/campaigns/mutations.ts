import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import { checkRecipientExtras } from '../../lib/campaigns/sample';
import { claimEmailImages } from '../../lib/attachments/emailImages';
import { employeeMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import { checkTrackedLinks } from '../../lib/campaigns/links';
import {
  loadResendContext,
  requeueSend,
  liveCampaign,
  requireLinkBase,
  settledCampaign,
} from '../../lib/campaigns/resend';
import { createAuditFields, updateAuditFields, logAudit } from '../../lib/audit/log';
import { loadEmailTemplate } from '../../lib/templates/records';
import {
  assertChannelDeliverable,
  resolveBrevo,
  resolveEmailProvider,
} from '../../lib/email/provider';
import { resolveCampaignContent } from '../../lib/campaigns/content';
import { loadAppConfig } from '../../lib/config/load';
import { scheduleDrain } from '../../lib/campaigns/drain';
import { failedSendCount } from '../../lib/campaigns/stats';
import { loadPropertyDefsById } from '../../lib/properties/definitions';
import {
  campaignChannelValidator,
  campaignSampleValidator,
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
    // The extras: contacts of these campaigns left out, a random share (`size` of the `of` counted) kept, the hosted images of a Claude Design body claimed here so the purge leaves them.
    excludeCampaignIds: v.optional(v.array(v.id('campaigns'))),
    sample: v.optional(campaignSampleValidator),
    emailImageIds: v.optional(v.array(v.id('emailImages'))),
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
    const cfg = await loadAppConfig(ctx);
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

    const { brevoTemplateId, subject, htmlBody, smsBody } = resolveCampaignContent(
      args,
      provider,
      smsAvailable,
    );

    const abTest = args.abTest ? checkAbTest(args.abTest, htmlBody) : undefined;
    const excludeCampaignIds = await checkRecipientExtras(ctx, args);

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
      excludeCampaignIds,
      sample: args.sample,
      status: 'draft',
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      statsCountedThrough: 'all',
      ...createAuditFields(ctx.userId),
    });
    const campaign = (await ctx.db.get(campaignId))!;
    if (args.emailImageIds?.length) await claimEmailImages(ctx, campaignId, args.emailImageIds);

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
    const campaign = await settledCampaign(ctx, args.campaignId);

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

/** Resends to every recipient, those who already received it included, or with `onlyFailed` to the failed sends alone (after a credit top-up, say): the sends are re-queued in scheduled batches, the drain follows, and the campaign reads `preparing` meanwhile. The gate is asked here as a preparation with every recipient, so an exhausted allowance refuses at once; the batches ask with what they re-queue, the last one as the resend. Returns how many sends are to leave again. */
export const resendAllCampaignSends = employeeMutation({
  args: { campaignId: v.id('campaigns'), onlyFailed: v.optional(v.boolean()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const campaign = await settledCampaign(ctx, args.campaignId);
    const count = args.onlyFailed ? await failedSendCount(ctx, campaign._id) : campaign.totalCount;
    if (count === 0) return 0;
    requireLinkBase(campaign);
    await requireSendAllowed(ctx, {
      source: 'campaign',
      channel: campaign.channel ?? 'email',
      count,
      stage: 'preparing',
    });

    // Counters reset: the batches count the skipped again, the drain what leaves. Links come back with the sends, so the purge sees the campaign again. A failed-only resend keeps both counters: its batches take out what they re-queue.
    await ctx.db.patch(args.campaignId, {
      ...(args.onlyFailed ? {} : { sentCount: 0, failedCount: 0 }),
      status: 'preparing',
      failureReason: undefined,
      linksPurgedAt: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.resendCampaignBatch, {
      campaignId: args.campaignId,
      only: args.onlyFailed ? 'failed' : undefined,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: args.onlyFailed ? 'retry_failed' : 'resend_all', count },
    });
    return count;
  },
});

/** A campaign that waits, or was taken off the schedule, gets a new time; `null` starts it now. */
export const scheduleCampaign = employeeMutation({
  args: { campaignId: v.id('campaigns'), scheduledAt: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await liveCampaign(ctx, args.campaignId);
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
    const campaign = await liveCampaign(ctx, args.campaignId);
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

/** A soft delete, refused while the campaign prepares or sends; a scheduled start is cancelled first. The sends, events and tracked links stay, so a STOP or a click on a message already out still resolves. */
export const deleteCampaign = employeeMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await settledCampaign(ctx, args.campaignId, false);
    if (campaign.status === 'scheduled') await cancelStart(ctx, campaign);
    await ctx.db.patch(args.campaignId, {
      deletedAt: Date.now(),
      scheduledAt: undefined,
      scheduledFnId: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'delete',
    });
    return null;
  },
});

/** « Arrêter l'envoi »: nothing more leaves. The sends still queued are cancelled a page at a time, and show as such; « Tout renvoyer » or a retry re-queues them. */
export const stopCampaignSending = employeeMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await liveCampaign(ctx, args.campaignId);
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

/** « Reprendre l'envoi » of a stopped campaign: the sends that were cancelled go back in the queue, nothing else; those already sent stay sent. The pages re-queue them, the drain follows the last. */
export const resumeCampaignSending = employeeMutation({
  args: { campaignId: v.id('campaigns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await liveCampaign(ctx, args.campaignId);
    if (campaign.status !== 'stopped') throw refusal('campaign_not_stopped');
    await assertChannelDeliverable(await loadAppConfig(ctx), campaign.channel ?? 'email');
    // What neither left nor failed is what was cancelled.
    const queued = Math.max(0, campaign.totalCount - campaign.sentCount - campaign.failedCount);
    if (queued > 0) {
      await requireSendAllowed(ctx, {
        source: 'campaign',
        channel: campaign.channel ?? 'email',
        count: queued,
        stage: 'preparing',
      });
    }
    await ctx.db.patch(args.campaignId, {
      status: 'preparing',
      failureReason: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAfter(0, internal.features.campaigns.internal.resendCampaignBatch, {
      campaignId: args.campaignId,
      only: 'cancelled',
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'campaign',
      entityId: args.campaignId,
      action: 'update',
      metadata: { event: 'resumed', count: queued },
    });
    return null;
  },
});
