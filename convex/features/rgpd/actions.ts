import { docOf } from '../../lib/shared/docs';
import { addressValidator } from '../../_lib/validators/shared';
import { marketingConsentChannelValidator } from '../../_lib/validators/crm';
import { consentSourceValidator } from '../../_lib/validators/crm';
import { propertyValueValidator } from '../../_lib/validators/properties';
import { campaignChannelValidator } from '../../_lib/validators/crm';
import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { employeeAction } from '../../_lib/auth';
import { authComponent } from '../../auth';
import type { ContactArchive } from '../../lib/rgpd/access';

/** Right of access: the archive of everything the CRM holds about one contact, for the settings holders; audited. */
export const exportContactData = employeeAction({
  args: { leadId: v.id('leads') },
  returns: v.object({
    requestId: v.id('rgpdRequests'),
    archive: v.object({
      exportedAt: v.number(),
      contact: v.object({
        _id: v.id('leads'),
        _creationTime: v.number(),
        firstName: v.string(),
        lastName: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        address: v.optional(addressValidator),
        marketingConsent: v.array(marketingConsentChannelValidator),
        consentUpdatedAt: v.optional(v.number()),
        consentSource: v.optional(consentSourceValidator),
        comment: v.optional(v.string()),
        isRedFlagged: v.boolean(),
        excludeFromProfiling: v.optional(v.boolean()),
        lifecycleStage: v.optional(v.string()),
        lastActivityAt: v.optional(v.number()),
        lastEmailOpenAt: v.optional(v.number()),
        emailOpenCount: v.optional(v.number()),
        lastEmailClickAt: v.optional(v.number()),
        emailClickCount: v.optional(v.number()),
        lastFormSubmissionAt: v.optional(v.number()),
        formSubmissionCount: v.optional(v.number()),
        lastPageViewAt: v.optional(v.number()),
        pageViewCount: v.optional(v.number()),
        customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
        updatedAt: v.number(),
        deletedAt: v.optional(v.number()),
      }),
      company: v.union(
        v.object({ name: v.string(), domain: v.union(v.string(), v.null()) }),
        v.null(),
      ),
      notes: v.array(docOf('leadNotes')),
      lifecycleHistory: v.array(docOf('lifecycleStageHistory')),
      lists: v.array(
        v.object({ name: v.string(), kind: v.union(v.literal('static'), v.literal('dynamic')) }),
      ),
      deals: v.array(docOf('deals')),
      activities: v.array(docOf('activities')),
      campaigns: v.array(
        v.object({
          campaign: v.union(
            v.object({
              name: v.string(),
              channel: campaignChannelValidator,
              subject: v.union(v.string(), v.null()),
            }),
            v.null(),
          ),
          send: docOf('campaignSends'),
          events: v.array(docOf('campaignEvents')),
        }),
      ),
      workflows: v.array(
        v.object({
          workflow: v.union(v.object({ name: v.string() }), v.null()),
          run: docOf('workflowRuns'),
          steps: v.array(docOf('workflowRunSteps')),
        }),
      ),
      formSubmissions: v.array(
        v.object({
          form: v.union(v.string(), v.null()),
          submittedAt: v.number(),
          values: v.record(v.string(), propertyValueValidator),
          userAgent: v.union(v.string(), v.null()),
        }),
      ),
      pageViews: v.array(
        v.object({
          at: v.number(),
          url: v.string(),
          title: v.union(v.string(), v.null()),
          referrer: v.union(v.string(), v.null()),
        }),
      ),
      scoring: v.object({
        excludedFromProfiling: v.boolean(),
        score: v.union(v.number(), v.null()),
        rules: v.array(v.object({ rule: v.string(), points: v.number() })),
      }),
      attachments: v.array(
        v.object({
          name: v.string(),
          folder: v.string(),
          mimeType: v.string(),
          size: v.number(),
          updatedAt: v.number(),
          deletedAt: v.union(v.number(), v.null()),
        }),
      ),
      audit: v.array(docOf('auditLogs')),
      cut: v.array(v.string()),
    }),
  }),
  handler: async (
    ctx,
    { leadId },
  ): Promise<{ requestId: Id<'rgpdRequests'>; archive: ContactArchive }> => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    const access: { userId: Id<'users'>; visible: boolean } | null = authUser
      ? await ctx.runQuery(internal.features.rgpd.internal.exportAccessOf, {
          authId: authUser._id,
          leadId,
        })
      : null;
    if (!access) throw new Error('Unauthorized: settings access');
    // Out of the role's perimeter reads like a contact that does not exist, as everywhere else.
    if (!access.visible) throw refusal('lead_not_found');
    const archive: ContactArchive | null = await ctx.runQuery(
      internal.features.rgpd.internal.collectContactData,
      { leadId },
    );
    if (!archive) throw refusal('lead_not_found');
    const requestId: Id<'rgpdRequests'> = await ctx.runMutation(
      internal.features.rgpd.internal.recordAccess,
      { leadId, userId: access.userId, cut: archive.cut },
    );
    return { requestId, archive };
  },
});
