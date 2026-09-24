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
import { loadVisibility, moduleAllows } from '../../lib/visibility';

/**
 * Whether the signed-in employee may export this contact, for the action, which has no db: the settings switch,
 * and the lead within the role's perimeter (a custom role may hold settings with leads at own, team or none).
 */
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

/** Every row about one contact, table by table, capped per table; the archive the person is entitled to. */
async function collect(ctx: QueryCtx, lead: Doc<'leads'>) {
  const cut: string[] = [];
  const cap = EXPORT_ROW_CAP;
  const capped = <T>(table: string, rows: T[]): T[] => {
    if (rows.length >= cap) cut.push(table);
    return rows;
  };
  const leadId = lead._id;
  // The tables are independent of one another: one round of reads, every part required.
  const [
    company,
    notes,
    lifecycleHistory,
    deals,
    activities,
    memberships,
    sends,
    events,
    runs,
    steps,
    attachmentRows,
    rules,
    audit,
  ] = await Promise.all([
    lead.companyId ? ctx.db.get(lead.companyId) : Promise.resolve(null),
    ctx.db
      .query('leadNotes')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('leadNotes', rows)),
    ctx.db
      .query('lifecycleStageHistory')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('lifecycleStageHistory', rows)),
    ctx.db
      .query('deals')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('deals', rows)),
    ctx.db
      .query('activities')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('activities', rows)),
    ctx.db
      .query('leadListMembers')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('leadListMembers', rows)),
    ctx.db
      .query('campaignSends')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('campaignSends', rows)),
    ctx.db
      .query('campaignEvents')
      .withIndex('by_lead_eventAt', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('campaignEvents', rows)),
    ctx.db
      .query('workflowRuns')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('workflowRuns', rows)),
    ctx.db
      .query('workflowRunSteps')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('workflowRunSteps', rows)),
    ctx.db
      .query('attachments')
      .withIndex('by_entity', (q) => q.eq('entityType', 'lead').eq('entityId', leadId))
      .take(cap)
      .then((rows) => capped('attachments', rows)),
    // Rules are read only; the loader's ctx type is the mutation one, the query ctx reads the same table.
    loadScoringRules(ctx as unknown as MutationCtx),
    ctx.db
      .query('auditLogs')
      .withIndex('by_entity', (q) => q.eq('entityType', 'lead').eq('entityId', leadId))
      .take(cap)
      .then((rows) => capped('auditLogs', rows)),
  ]);
  const [listDocs, campaignDocs, workflowDocs] = await Promise.all([
    Promise.all(memberships.map((m) => ctx.db.get(m.listId))),
    Promise.all([...new Set(sends.map((s) => s.campaignId))].map((id) => ctx.db.get(id))),
    Promise.all([...new Set(runs.map((r) => r.workflowId))].map((id) => ctx.db.get(id))),
  ]);
  const lists = listDocs.flatMap((list) =>
    list ? [{ name: list.name, kind: list.kind ?? 'static' }] : [],
  );
  const campaignById = new Map(campaignDocs.flatMap((c) => (c ? [[c._id, c] as const] : [])));
  const campaigns = sends.map((send) => {
    const campaign = campaignById.get(send.campaignId);
    return {
      campaign: campaign
        ? {
            name: campaign.name,
            channel: campaign.channel ?? 'email',
            subject: campaign.subject ?? null,
          }
        : null,
      send,
      events: events.filter((e) => e.sendId === send._id),
    };
  });
  const workflowById = new Map(workflowDocs.flatMap((w) => (w ? [[w._id, w] as const] : [])));
  const workflows = runs.map((run) => {
    const workflow = workflowById.get(run.workflowId);
    return {
      workflow: workflow ? { name: workflow.name } : null,
      run,
      steps: steps.filter((s) => s.runId === run._id),
    };
  });
  const attachments = attachmentRows.map((a) => ({
    name: a.name,
    folder: a.folder,
    mimeType: a.mimeType,
    size: a.size,
    updatedAt: a.updatedAt,
    deletedAt: a.deletedAt ?? null,
  }));
  const scored = lead.excludeFromProfiling ? null : computeLeadScore(lead, rules, Date.now());
  const scoring = {
    excludedFromProfiling: lead.excludeFromProfiling ?? false,
    score: scored?.score ?? null,
    rules: Object.entries(scored?.breakdown ?? {}).map(([ruleId, points]) => ({
      rule: rules.find((r) => r._id === ruleId)?.name ?? ruleId,
      points,
    })),
  };
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
