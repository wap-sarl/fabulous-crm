import { docOf } from '../../lib/shared/docs';
import { addressValidator } from '../../_lib/validators/shared';
import { marketingConsentChannelValidator } from '../../_lib/validators/crm';
import { consentSourceValidator } from '../../_lib/validators/crm';
import { propertyValueValidator } from '../../_lib/validators/properties';
import { campaignChannelValidator } from '../../_lib/validators/crm';
import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalQuery, type MutationCtx } from '../../_generated/server';
import { internalMutation } from '../../_lib/functions';
import { logAudit } from '../../lib/audit/log';
import {
  addCounts,
  emptyCounts,
  newPageState,
  PURGE_CASCADE_BATCH,
  PURGE_ROW_PAGE,
  type PurgeCounts,
} from '../../lib/retention/budget';
import { purgeLeadRows } from '../../lib/retention/rows';
import { collect } from '../../lib/rgpd/access';
import { loadVisibility, moduleAllows } from '../../lib/roles/visibility';

/** For the export action, which has no db: the settings switch is not enough, a custom role may hold settings with leads at own, team or none. */
export const exportAccessOf = internalQuery({
  args: { authId: v.string(), leadId: v.id('leads') },
  returns: v.union(v.object({ userId: v.id('users'), visible: v.boolean() }), v.null()),
  handler: async (ctx, { authId, leadId }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_authId', (q) => q.eq('authId', authId))
      .first();
    if (user?.type !== 'employee' || user.deletedAt !== undefined) return null;
    const visibility = await loadVisibility(ctx, user);
    if (!visibility.access.settings) return null;
    const lead = await ctx.db.get(leadId);
    return {
      userId: user._id,
      visible: !!lead && moduleAllows(visibility, 'leads', lead.ownerIds),
    };
  },
});

export const collectContactData = internalQuery({
  args: { leadId: v.id('leads') },
  returns: v.union(
    v.object({
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
    v.null(),
  ),
  handler: async (ctx, { leadId }) => {
    const lead = await ctx.db.get(leadId);
    return lead ? await collect(ctx, lead) : null;
  },
});

/** The export is a request handled: one row, and an audit entry on the contact. */
export const recordAccess = internalMutation({
  args: { leadId: v.id('leads'), userId: v.id('users'), cut: v.array(v.string()) },
  returns: v.id('rgpdRequests'),
  handler: async (ctx, { leadId, userId, cut }) => {
    const now = Date.now();
    const requestId = await ctx.db.insert('rgpdRequests', {
      type: 'access',
      leadId,
      requestedBy: userId,
      requestedAt: now,
      completedAt: now,
      outcome: 'done',
      detail: { cut },
    });
    await logAudit({
      ctx,
      userId,
      entityType: 'lead',
      entityId: leadId,
      action: 'update',
      metadata: { rgpd: 'access', requestId },
    });
    return requestId;
  },
});

/** Deletes the audit rows of a batch of rows the contact owns, before the rows themselves go. */
async function eraseAuditOf(
  ctx: MutationCtx,
  entityType: 'leadNote' | 'workflowRun',
  ids: string[],
): Promise<number> {
  let erased = 0;
  for (const id of ids) {
    const rows = await ctx.db
      .query('auditLogs')
      .withIndex('by_entity', (q) => q.eq('entityType', entityType).eq('entityId', id))
      .take(PURGE_ROW_PAGE);
    for (const row of rows) await ctx.db.delete(row._id);
    erased += rows.length;
  }
  return erased;
}

/** One budgeted step of an erasure, which schedules the next when it cannot finish; what stays is one anonymised audit row and the request. */
export const eraseStep = internalMutation({
  args: { leadId: v.id('leads'), requestId: v.id('rgpdRequests'), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { leadId, requestId, userId }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.outcome === 'done') return null;
    const detail = (request.detail ?? {}) as { counts?: PurgeCounts; resumed?: number };
    const sofar = detail.counts ?? emptyCounts();
    const again = async (counts: PurgeCounts) => {
      await ctx.db.patch(requestId, { detail: { ...detail, counts } });
      await ctx.scheduler.runAfter(0, internal.features.rgpd.internal.eraseStep, {
        leadId,
        requestId,
        userId,
      });
      return null;
    };
    const lead = await ctx.db.get(leadId);
    const state = newPageState();
    if (lead) {
      const notes = await ctx.db
        .query('leadNotes')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .take(PURGE_CASCADE_BATCH);
      const runs = await ctx.db
        .query('workflowRuns')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .take(PURGE_CASCADE_BATCH);
      state.counts.auditLogs += await eraseAuditOf(
        ctx,
        'leadNote',
        notes.map((n) => n._id),
      );
      state.counts.auditLogs += await eraseAuditOf(
        ctx,
        'workflowRun',
        runs.map((r) => r._id),
      );
      if (!(await purgeLeadRows(ctx, state, leadId))) return again(addCounts(sofar, state.counts));
      const own = await ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'lead').eq('entityId', leadId))
        .take(PURGE_ROW_PAGE);
      for (const row of own) await ctx.db.delete(row._id);
      state.counts.auditLogs += own.length;
      if (own.length >= PURGE_ROW_PAGE) return again(addCounts(sofar, state.counts));
      await ctx.db.delete(leadId);
      state.counts.leads += 1;
    }
    const counts = addCounts(sofar, state.counts);
    await ctx.db.patch(requestId, {
      outcome: 'done',
      completedAt: Date.now(),
      detail: { ...detail, counts },
    });
    // The one row that stays: the id and the date, nothing of the person.
    await logAudit({
      ctx,
      userId,
      entityType: 'lead',
      entityId: leadId,
      action: 'delete',
      metadata: { rgpd: 'erasure', requestId },
    });
    return null;
  },
});

/** A step that threw leaves its request in progress with nothing scheduled; past this age it is taken up again. */
export const ERASURE_STALL_MS = 15 * 60_000;

/** Convex does not retry a mutation that threw, so a failed erasure would stay in progress for ever; the step is idempotent, scheduling it again is enough. */
export const resumeStalledErasures = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - ERASURE_STALL_MS;
    const stalled = await ctx.db
      .query('rgpdRequests')
      .withIndex('by_outcome_requestedAt', (q) =>
        q.eq('outcome', 'in_progress').lt('requestedAt', cutoff),
      )
      .take(100);
    let resumed = 0;
    for (const request of stalled) {
      const leadId = ctx.db.normalizeId('leads', request.leadId);
      if (request.type !== 'erasure' || !leadId) continue;
      const detail = (request.detail ?? {}) as { counts?: PurgeCounts; resumed?: number };
      const attempt = (detail.resumed ?? 0) + 1;
      // The lead page is the only place showing an erasure in progress: a persistent failure shows in the logs.
      console.warn(
        `rgpd: erasure ${request._id} in progress since ${new Date(request.requestedAt).toISOString()}, scheduled again (attempt ${attempt})`,
      );
      await ctx.db.patch(request._id, { detail: { ...detail, resumed: attempt } });
      await ctx.scheduler.runAfter(0, internal.features.rgpd.internal.eraseStep, {
        leadId,
        requestId: request._id,
        userId: request.requestedBy,
      });
      resumed += 1;
    }
    return resumed;
  },
});
