import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { AttachmentEntityType } from '../../_lib/validators/attachments';
import { fileStore } from '../attachments/storage';
import { deleteListMember } from '../leadLists/members';
import { PURGE_CASCADE_BATCH, type PageState, room, drain } from './budget';

async function purgeAttachmentsOf(
  ctx: MutationCtx,
  state: PageState,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<boolean> {
  const limit = room(state, PURGE_CASCADE_BATCH);
  if (limit === 0) return true;
  const rows = await ctx.db
    .query('attachments')
    .withIndex('by_entity', (q) => q.eq('entityType', entityType).eq('entityId', entityId))
    .take(limit);
  state.counts.attachments += rows.length;
  return drain(state, rows, limit, async (attachment) => {
    await fileStore(attachment.provider).delete(ctx, attachment);
    await ctx.db.delete(attachment._id);
  });
}

type Related =
  | 'leadNotes'
  | 'lifecycleStageHistory'
  | 'dealStageHistory'
  | 'campaignEvents'
  | 'leadDuplicates'
  | 'formSubmissions'
  | 'formVisitorTokens'
  | 'pageViews'
  | 'webVisitors';

/** Deletes one batch of related rows; a query the page has no room for counts as pending. */
async function purgeRelated(
  ctx: MutationCtx,
  state: PageState,
  query: (limit: number) => Promise<{ _id: Id<Related> }[]>,
): Promise<boolean> {
  const limit = room(state, PURGE_CASCADE_BATCH);
  if (limit === 0) return true;
  const rows = await query(limit);
  state.counts.related += rows.length;
  return drain(state, rows, limit, (row) => ctx.db.delete(row._id));
}

/** Unlinks one batch of rows that outlive the entity (a deal or an activity keeps its own life). */
async function unlink<T extends { _id: Id<'deals'> | Id<'activities'> | Id<'leads'> }>(
  ctx: MutationCtx,
  state: PageState,
  query: (limit: number) => Promise<T[]>,
  patch: Record<string, undefined>,
): Promise<boolean> {
  const limit = room(state, PURGE_CASCADE_BATCH);
  if (limit === 0) return true;
  const rows = await query(limit);
  return drain(state, rows, limit, (row) => ctx.db.patch(row._id, patch));
}

/** Everything a lead owns goes with it; a live deal or activity only loses its link. Returns whether the lead may go now. */
export async function purgeLeadRows(ctx: MutationCtx, state: PageState, leadId: Id<'leads'>) {
  let pending = false;
  pending ||= await purgeRelated(ctx, state, (limit) =>
    ctx.db
      .query('leadNotes')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(limit),
  );
  pending ||= await purgeRelated(ctx, state, (limit) =>
    ctx.db
      .query('campaignEvents')
      .withIndex('by_lead_eventAt', (q) => q.eq('leadId', leadId))
      .take(limit),
  );
  pending ||= await purgeRelated(ctx, state, (limit) =>
    ctx.db
      .query('lifecycleStageHistory')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(limit),
  );
  // What the person typed into public forms, and the browser identity that ties later renders to them.
  pending ||= await purgeRelated(ctx, state, (limit) =>
    ctx.db
      .query('formSubmissions')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(limit),
  );
  pending ||= await purgeRelated(ctx, state, (limit) =>
    ctx.db
      .query('formVisitorTokens')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(limit),
  );
  // Where the person browsed, and the browsers tied to them.
  pending ||= await purgeRelated(ctx, state, (limit) =>
    ctx.db
      .query('pageViews')
      .withIndex('by_lead_at', (q) => q.eq('leadId', leadId))
      .take(limit),
  );
  pending ||= await purgeRelated(ctx, state, (limit) =>
    ctx.db
      .query('webVisitors')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(limit),
  );
  for (const index of ['by_leadA', 'by_leadB'] as const) {
    const field = index === 'by_leadA' ? 'leadAId' : 'leadBId';
    pending ||= await purgeRelated(ctx, state, (limit) =>
      ctx.db
        .query('leadDuplicates')
        .withIndex(index, (q) => q.eq(field, leadId))
        .take(limit),
    );
  }
  const sendRoom = room(state, PURGE_CASCADE_BATCH);
  if (sendRoom === 0) pending = true;
  else {
    const sends = await ctx.db
      .query('campaignSends')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(sendRoom);
    state.counts.related += sends.length;
    pending ||= await drain(state, sends, sendRoom, async (send) => {
      // A send carries at most one token per tracked link.
      const tokens = await ctx.db
        .query('campaignLinkTokens')
        .withIndex('by_send', (q) => q.eq('sendId', send._id))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
      state.counts.related += tokens.length;
      state.budget -= tokens.length;
      await ctx.db.delete(send._id);
    });
  }
  const runRoom = room(state, PURGE_CASCADE_BATCH);
  if (runRoom === 0) pending = true;
  else {
    const runs = await ctx.db
      .query('workflowRuns')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(runRoom);
    state.counts.related += runs.length;
    pending ||= await drain(state, runs, runRoom, async (run) => {
      // Bounded by MAX_STEPS_PER_RUN; a wait still scheduled finds no run and does nothing.
      const steps = await ctx.db
        .query('workflowRunSteps')
        .withIndex('by_run', (q) => q.eq('runId', run._id))
        .collect();
      for (const step of steps) await ctx.db.delete(step._id);
      state.counts.related += steps.length;
      state.budget -= steps.length;
      await ctx.db.delete(run._id);
    });
  }
  const memberRoom = room(state, PURGE_CASCADE_BATCH);
  if (memberRoom === 0) pending = true;
  else {
    const memberships = await ctx.db
      .query('leadListMembers')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(memberRoom);
    state.counts.related += memberships.length;
    pending ||= await drain(state, memberships, memberRoom, (member) =>
      deleteListMember(ctx, member),
    );
  }
  pending ||= await purgeAttachmentsOf(ctx, state, 'lead', leadId);
  pending ||= await unlink(
    ctx,
    state,
    (limit) =>
      ctx.db
        .query('deals')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .take(limit),
    { leadId: undefined },
  );
  pending ||= await unlink(
    ctx,
    state,
    (limit) =>
      ctx.db
        .query('activities')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .take(limit),
    { leadId: undefined },
  );
  return !pending;
}

export async function purgeCompanyRows(
  ctx: MutationCtx,
  state: PageState,
  companyId: Id<'companies'>,
) {
  let pending = false;
  pending ||= await unlink(
    ctx,
    state,
    (limit) =>
      ctx.db
        .query('leads')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(limit),
    { companyId: undefined },
  );
  pending ||= await unlink(
    ctx,
    state,
    (limit) =>
      ctx.db
        .query('activities')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(limit),
    { companyId: undefined },
  );
  pending ||= await purgeAttachmentsOf(ctx, state, 'company', companyId);
  return !pending;
}

export async function purgeDealRows(ctx: MutationCtx, state: PageState, dealId: Id<'deals'>) {
  let pending = false;
  pending ||= await purgeRelated(ctx, state, (limit) =>
    ctx.db
      .query('dealStageHistory')
      .withIndex('by_deal', (q) => q.eq('dealId', dealId))
      .take(limit),
  );
  pending ||= await unlink(
    ctx,
    state,
    (limit) =>
      ctx.db
        .query('activities')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .take(limit),
    { dealId: undefined },
  );
  pending ||= await purgeAttachmentsOf(ctx, state, 'deal', dealId);
  return !pending;
}
