import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import { internalQuery, type MutationCtx, type QueryCtx } from '../../_generated/server';
import { internalMutation } from '../../_lib/functions';
import { EXPORT_ROW_CAP } from '../../_lib/validators/rgpd';
import { logAudit } from '../../lib';
import { computeLeadScore, loadScoringRules } from '../../lib/leadScoring';
import {
  addCounts,
  emptyCounts,
  newPageState,
  PURGE_CASCADE_BATCH,
  PURGE_ROW_PAGE,
  type PurgeCounts,
  purgeLeadRows,
} from '../../lib/retention';
import { loadVisibility } from '../../lib/visibility';

/** Whether the signed-in employee may handle RGPD requests (the settings switch); for the export action, which has no db. */
export const settingsAccessOf = internalQuery({
  args: { authId: v.string() },
  returns: v.union(v.object({ userId: v.id('users') }), v.null()),
  handler: async (ctx, { authId }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_authId', (q) => q.eq('authId', authId))
      .first();
    if (user?.type !== 'employee' || user.deletedAt !== undefined) return null;
    const visibility = await loadVisibility(ctx, user);
    return visibility.access.settings ? { userId: user._id } : null;
  },
});

/** Every row about one contact, table by table, capped per table; the archive the person is entitled to. */
async function collect(ctx: QueryCtx, lead: Doc<'leads'>) {
  const cut: string[] = [];
  const cap = EXPORT_ROW_CAP;
  const capped = <T>(table: string, rows: T[]): T[] => {
    if (rows.length >= cap) cut.push(table);
    return rows;
  };
  const leadId = lead._id;

  const company = lead.companyId ? await ctx.db.get(lead.companyId) : null;
  const notes = capped(
    'leadNotes',
    await ctx.db
      .query('leadNotes')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap),
  );
  const lifecycleHistory = capped(
    'lifecycleStageHistory',
    await ctx.db
      .query('lifecycleStageHistory')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap),
  );
  const deals = capped(
    'deals',
    await ctx.db
      .query('deals')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap),
  );
  const activities = capped(
    'activities',
    await ctx.db
      .query('activities')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap),
  );
  const memberships = capped(
    'leadListMembers',
    await ctx.db
      .query('leadListMembers')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap),
  );
  const lists: { name: string; kind: string }[] = [];
  for (const member of memberships) {
    const list = await ctx.db.get(member.listId);
    if (list) lists.push({ name: list.name, kind: list.kind ?? 'static' });
  }
  const sends = capped(
    'campaignSends',
    await ctx.db
      .query('campaignSends')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap),
  );
  const campaigns = [];
  for (const send of sends) {
    const campaign = await ctx.db.get(send.campaignId);
    const events = await ctx.db
      .query('campaignEvents')
      .withIndex('by_send', (q) => q.eq('sendId', send._id))
      .take(cap);
    campaigns.push({
      campaign: campaign
        ? {
            name: campaign.name,
            channel: campaign.channel ?? 'email',
            subject: campaign.subject ?? null,
          }
        : null,
      send,
      events,
    });
  }
  const runs = capped(
    'workflowRuns',
    await ctx.db
      .query('workflowRuns')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap),
  );
  const workflows = [];
  for (const run of runs) {
    const workflow = await ctx.db.get(run.workflowId);
    const steps = await ctx.db
      .query('workflowRunSteps')
      .withIndex('by_run', (q) => q.eq('runId', run._id))
      .collect();
    workflows.push({ workflow: workflow ? { name: workflow.name } : null, run, steps });
  }
  const attachments = (
    await ctx.db
      .query('attachments')
      .withIndex('by_entity', (q) => q.eq('entityType', 'lead').eq('entityId', leadId))
      .take(cap)
  ).map((a) => ({
    name: a.name,
    folder: a.folder,
    mimeType: a.mimeType,
    size: a.size,
    updatedAt: a.updatedAt,
    deletedAt: a.deletedAt ?? null,
  }));
  // Rules are read only; the loader's ctx type is the mutation one, the query ctx reads the same table.
  const rules = await loadScoringRules(ctx as unknown as MutationCtx);
  const scored = lead.excludeFromProfiling ? null : computeLeadScore(lead, rules, Date.now());
  const scoring = {
    excludedFromProfiling: lead.excludeFromProfiling ?? false,
    score: scored?.score ?? null,
    rules: Object.entries(scored?.breakdown ?? {}).map(([ruleId, points]) => ({
      rule: rules.find((r) => r._id === ruleId)?.name ?? ruleId,
      points,
    })),
  };
  const audit = capped(
    'auditLogs',
    await ctx.db
      .query('auditLogs')
      .withIndex('by_entity', (q) => q.eq('entityType', 'lead').eq('entityId', leadId))
      .take(cap),
  );
  return {
    exportedAt: Date.now(),
    contact: lead,
    company: company ? { name: company.name, domain: company.domain ?? null } : null,
    notes,
    lifecycleHistory,
    lists,
    deals,
    activities,
    campaigns,
    workflows,
    scoring,
    attachments,
    audit,
    // Tables read up to their cap; the archive is complete when this is empty.
    cut,
  };
}

export type ContactArchive = Awaited<ReturnType<typeof collect>>;

export const collectContactData = internalQuery({
  args: { leadId: v.id('leads') },
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

/**
 * One step of an erasure: the audit trail of what goes, then everything the contact owns (the retention
 * cascade, one budgeted page), then the contact's own audit rows, then the contact; a step that cannot finish
 * schedules the next. What stays is one anonymised audit row and the request.
 */
export const eraseStep = internalMutation({
  args: { leadId: v.id('leads'), requestId: v.id('rgpdRequests'), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { leadId, requestId, userId }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.outcome === 'done') return null;
    const sofar = (request.detail as { counts?: PurgeCounts } | undefined)?.counts ?? emptyCounts();
    const again = async (counts: PurgeCounts) => {
      await ctx.db.patch(requestId, { detail: { counts } });
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
    await ctx.db.patch(requestId, { outcome: 'done', completedAt: Date.now(), detail: { counts } });
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
