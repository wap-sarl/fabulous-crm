import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { EXPORT_ROW_CAP } from '../../_lib/validators/rgpd';
import { computeLeadScore, loadScoringRules } from '../scoring/score';

/** Every row about one contact, table by table, capped per table; the archive the person is entitled to. */
export async function collect(ctx: QueryCtx, lead: Doc<'leads'>) {
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
    submissions,
    pageViews,
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
      .query('formSubmissions')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('formSubmissions', rows)),
    ctx.db
      .query('pageViews')
      .withIndex('by_lead_at', (q) => q.eq('leadId', leadId))
      .take(cap)
      .then((rows) => capped('pageViews', rows)),
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
  const [listDocs, campaignDocs, workflowDocs, formDocs] = await Promise.all([
    Promise.all(memberships.map((m) => ctx.db.get(m.listId))),
    Promise.all([...new Set(sends.map((s) => s.campaignId))].map((id) => ctx.db.get(id))),
    Promise.all([...new Set(runs.map((r) => r.workflowId))].map((id) => ctx.db.get(id))),
    Promise.all([...new Set(submissions.map((s) => s.formId))].map((id) => ctx.db.get(id))),
  ]);
  const formById = new Map(formDocs.flatMap((f) => (f ? [[f._id, f] as const] : [])));
  // What the person typed, under the form's name; the salted IP hash is the CRM's, not theirs.
  const formSubmissions = submissions.map((s) => ({
    form: formById.get(s.formId)?.name ?? null,
    submittedAt: s._creationTime,
    values: s.values,
    userAgent: s.userAgent ?? null,
  }));
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
  // The person's own data: not the consent link's secret, the search and dedupe keys, nor the employees in charge.
  const contact = {
    _id: lead._id,
    _creationTime: lead._creationTime,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    address: lead.address,
    marketingConsent: lead.marketingConsent,
    consentUpdatedAt: lead.consentUpdatedAt,
    consentSource: lead.consentSource,
    comment: lead.comment,
    isRedFlagged: lead.isRedFlagged,
    excludeFromProfiling: lead.excludeFromProfiling,
    lifecycleStage: lead.lifecycleStage,
    lastActivityAt: lead.lastActivityAt,
    lastEmailOpenAt: lead.lastEmailOpenAt,
    emailOpenCount: lead.emailOpenCount,
    lastEmailClickAt: lead.lastEmailClickAt,
    emailClickCount: lead.emailClickCount,
    lastFormSubmissionAt: lead.lastFormSubmissionAt,
    formSubmissionCount: lead.formSubmissionCount,
    lastPageViewAt: lead.lastPageViewAt,
    pageViewCount: lead.pageViewCount,
    customProperties: lead.customProperties,
    updatedAt: lead.updatedAt,
    deletedAt: lead.deletedAt,
  };
  return {
    exportedAt: Date.now(),
    contact,
    company: company ? { name: company.name, domain: company.domain ?? null } : null,
    notes,
    lifecycleHistory,
    lists,
    deals,
    activities,
    campaigns,
    workflows,
    formSubmissions,
    // Where the person browsed, as the tracking recorded it; the browser id is the CRM's, not theirs.
    pageViews: pageViews.map((v) => ({
      at: v.at,
      url: v.url,
      title: v.title ?? null,
      referrer: v.referrer ?? null,
    })),
    scoring,
    attachments,
    audit,
    // Tables read up to their cap; the archive is complete when this is empty.
    cut,
  };
}

export type ContactArchive = Awaited<ReturnType<typeof collect>>;
