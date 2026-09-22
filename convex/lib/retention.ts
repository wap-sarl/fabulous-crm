import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { AttachmentEntityType } from '../_lib/validators/attachments';
import type { RetentionPolicy } from '../_lib/validators/retention';
import { fileStore } from './fileStorage';
import { deleteListMember } from './leadListMembers';

// The nightly purge, one bounded page at a time; features/retention/internal.ts chains the pages.

/** Soft-deleted entities examined per page: each may drag hundreds of related rows along. */
export const PURGE_ENTITY_PAGE = 20;
/** Rows deleted per event table per page. */
export const PURGE_ROW_PAGE = 500;
/** Related rows deleted per table per entity per page; an entity with more waits for the next page. */
export const PURGE_CASCADE_BATCH = 200;
/** Pages a run may chain before it stops and reports itself truncated. */
export const PURGE_MAX_PAGES = 200;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const PURGE_COUNT_KEYS = [
  'leads',
  'companies',
  'deals',
  'activities',
  'related',
  'attachments',
  'campaignEvents',
  'workflowRunSteps',
  'campaignLinkTokens',
  'invitations',
  'apiIdempotencyKeys',
  'auditLogs',
] as const;
export type PurgeCounts = Record<(typeof PURGE_COUNT_KEYS)[number], number>;
export const purgeCountsValidator = v.object(
  Object.fromEntries(PURGE_COUNT_KEYS.map((key) => [key, v.number()])) as Record<
    (typeof PURGE_COUNT_KEYS)[number],
    ReturnType<typeof v.number>
  >,
);
export const emptyCounts = (): PurgeCounts =>
  Object.fromEntries(PURGE_COUNT_KEYS.map((key) => [key, 0])) as PurgeCounts;
export const addCounts = (a: PurgeCounts, b: PurgeCounts): PurgeCounts =>
  Object.fromEntries(PURGE_COUNT_KEYS.map((key) => [key, a[key] + b[key]])) as PurgeCounts;

interface PageState {
  counts: PurgeCounts;
  /** Some table still held rows past a full batch: another page is needed. */
  moreLeft: boolean;
}

/** Applies `act` to a batch; a full batch means the table may hold more. */
async function drain<T extends { _id: Id<'leads'> | string }>(
  state: PageState,
  rows: T[],
  batch: number,
  act: (row: T) => Promise<void>,
): Promise<boolean> {
  for (const row of rows) await act(row);
  const full = rows.length >= batch;
  if (full) state.moreLeft = true;
  return full;
}

async function purgeAttachmentsOf(
  ctx: MutationCtx,
  state: PageState,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<boolean> {
  const rows = await ctx.db
    .query('attachments')
    .withIndex('by_entity', (q) => q.eq('entityType', entityType).eq('entityId', entityId))
    .take(PURGE_CASCADE_BATCH);
  state.counts.attachments += rows.length;
  return drain(state, rows, PURGE_CASCADE_BATCH, async (attachment) => {
    await fileStore(attachment.provider).delete(ctx, attachment);
    await ctx.db.delete(attachment._id);
  });
}

/** Everything a lead owns goes with it; a live deal or activity only loses its link. Returns whether the lead may go now. */
async function purgeLeadRows(ctx: MutationCtx, state: PageState, leadId: Id<'leads'>) {
  let pending = false;
  const gone = async (
    rows: {
      _id:
        | Id<'leadNotes'>
        | Id<'campaignEvents'>
        | Id<'lifecycleStageHistory'>
        | Id<'leadDuplicates'>;
    }[],
  ) => {
    state.counts.related += rows.length;
    return drain(state, rows, PURGE_CASCADE_BATCH, (row) => ctx.db.delete(row._id));
  };
  pending ||= await gone(
    await ctx.db
      .query('leadNotes')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(PURGE_CASCADE_BATCH),
  );
  pending ||= await gone(
    await ctx.db
      .query('campaignEvents')
      .withIndex('by_lead_eventAt', (q) => q.eq('leadId', leadId))
      .take(PURGE_CASCADE_BATCH),
  );
  pending ||= await gone(
    await ctx.db
      .query('lifecycleStageHistory')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .take(PURGE_CASCADE_BATCH),
  );
  for (const index of ['by_leadA', 'by_leadB'] as const) {
    const field = index === 'by_leadA' ? 'leadAId' : 'leadBId';
    pending ||= await gone(
      await ctx.db
        .query('leadDuplicates')
        .withIndex(index, (q) => q.eq(field, leadId))
        .take(PURGE_CASCADE_BATCH),
    );
  }
  const sends = await ctx.db
    .query('campaignSends')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(PURGE_CASCADE_BATCH);
  state.counts.related += sends.length;
  pending ||= await drain(state, sends, PURGE_CASCADE_BATCH, async (send) => {
    // A send carries at most one token per tracked link.
    const tokens = await ctx.db
      .query('campaignLinkTokens')
      .withIndex('by_send', (q) => q.eq('sendId', send._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
    state.counts.related += tokens.length;
    await ctx.db.delete(send._id);
  });
  const runs = await ctx.db
    .query('workflowRuns')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(PURGE_CASCADE_BATCH);
  state.counts.related += runs.length;
  pending ||= await drain(state, runs, PURGE_CASCADE_BATCH, async (run) => {
    // Bounded by MAX_STEPS_PER_RUN; a wait still scheduled finds no run and does nothing.
    const steps = await ctx.db
      .query('workflowRunSteps')
      .withIndex('by_run', (q) => q.eq('runId', run._id))
      .collect();
    for (const step of steps) await ctx.db.delete(step._id);
    state.counts.related += steps.length;
    await ctx.db.delete(run._id);
  });
  const memberships = await ctx.db
    .query('leadListMembers')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(PURGE_CASCADE_BATCH);
  state.counts.related += memberships.length;
  pending ||= await drain(state, memberships, PURGE_CASCADE_BATCH, (member) =>
    deleteListMember(ctx, member),
  );
  pending ||= await purgeAttachmentsOf(ctx, state, 'lead', leadId);
  const deals = await ctx.db
    .query('deals')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(PURGE_CASCADE_BATCH);
  pending ||= await drain(state, deals, PURGE_CASCADE_BATCH, (deal) =>
    ctx.db.patch(deal._id, { leadId: undefined }),
  );
  const activities = await ctx.db
    .query('activities')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(PURGE_CASCADE_BATCH);
  pending ||= await drain(state, activities, PURGE_CASCADE_BATCH, (activity) =>
    ctx.db.patch(activity._id, { leadId: undefined }),
  );
  return !pending;
}

async function purgeCompanyRows(ctx: MutationCtx, state: PageState, companyId: Id<'companies'>) {
  let pending = false;
  const leads = await ctx.db
    .query('leads')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(PURGE_CASCADE_BATCH);
  pending ||= await drain(state, leads, PURGE_CASCADE_BATCH, (lead) =>
    ctx.db.patch(lead._id, { companyId: undefined }),
  );
  const activities = await ctx.db
    .query('activities')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(PURGE_CASCADE_BATCH);
  pending ||= await drain(state, activities, PURGE_CASCADE_BATCH, (activity) =>
    ctx.db.patch(activity._id, { companyId: undefined }),
  );
  pending ||= await purgeAttachmentsOf(ctx, state, 'company', companyId);
  return !pending;
}

async function purgeDealRows(ctx: MutationCtx, state: PageState, dealId: Id<'deals'>) {
  let pending = false;
  const history = await ctx.db
    .query('dealStageHistory')
    .withIndex('by_deal', (q) => q.eq('dealId', dealId))
    .take(PURGE_CASCADE_BATCH);
  state.counts.related += history.length;
  pending ||= await drain(state, history, PURGE_CASCADE_BATCH, (row) => ctx.db.delete(row._id));
  const activities = await ctx.db
    .query('activities')
    .withIndex('by_deal', (q) => q.eq('dealId', dealId))
    .take(PURGE_CASCADE_BATCH);
  pending ||= await drain(state, activities, PURGE_CASCADE_BATCH, (activity) =>
    ctx.db.patch(activity._id, { dealId: undefined }),
  );
  pending ||= await purgeAttachmentsOf(ctx, state, 'deal', dealId);
  return !pending;
}

type Trashed = 'leads' | 'companies' | 'deals' | 'activities';

/** The soft-deleted rows of a table past their retention, oldest first; a missing `deletedAt` sorts below any number and stays out. */
const trashOf = (ctx: MutationCtx, table: Trashed, cutoff: number) =>
  ctx.db
    .query(table)
    .withIndex('by_deletedAt', (q) => q.gt('deletedAt', 0).lt('deletedAt', cutoff))
    .take(PURGE_ENTITY_PAGE);

/** One page of the purge: every table gets a bounded share; `moreLeft` asks for another page. */
export async function purgePage(
  ctx: MutationCtx,
  policy: RetentionPolicy,
  now: number,
): Promise<PageState> {
  const state: PageState = { counts: emptyCounts(), moreLeft: false };
  const trashCutoff = now - policy.softDeleteDays * DAY_MS;
  const eventCutoff = now - policy.eventDays * DAY_MS;
  const auditCutoff = now - policy.auditDays * DAY_MS;

  for (const lead of await trashOf(ctx, 'leads', trashCutoff)) {
    if (await purgeLeadRows(ctx, state, lead._id as Id<'leads'>)) {
      await ctx.db.delete(lead._id);
      state.counts.leads += 1;
    }
  }
  for (const company of await trashOf(ctx, 'companies', trashCutoff)) {
    if (await purgeCompanyRows(ctx, state, company._id as Id<'companies'>)) {
      await ctx.db.delete(company._id);
      state.counts.companies += 1;
    }
  }
  for (const deal of await trashOf(ctx, 'deals', trashCutoff)) {
    if (await purgeDealRows(ctx, state, deal._id as Id<'deals'>)) {
      await ctx.db.delete(deal._id);
      state.counts.deals += 1;
    }
  }
  const activities = await trashOf(ctx, 'activities', trashCutoff);
  state.counts.activities += activities.length;
  await drain(state, activities, PURGE_ENTITY_PAGE, (row) => ctx.db.delete(row._id));
  // Anything still in the trash past its date, left behind by the page or waiting on its cascade, asks for another page.
  for (const table of ['leads', 'companies', 'deals', 'activities'] as const) {
    if ((await trashOf(ctx, table, trashCutoff)).length > 0) state.moreLeft = true;
  }

  const events = await ctx.db
    .query('campaignEvents')
    .withIndex('by_eventAt', (q) => q.lt('eventAt', eventCutoff))
    .take(PURGE_ROW_PAGE);
  state.counts.campaignEvents += events.length;
  await drain(state, events, PURGE_ROW_PAGE, (row) => ctx.db.delete(row._id));

  // A step still pending belongs to a run still parked on it, whatever its age.
  const steps = await ctx.db
    .query('workflowRunSteps')
    .withIndex('by_startedAt', (q) => q.lt('startedAt', eventCutoff))
    .filter((q) => q.neq(q.field('status'), 'pending'))
    .take(PURGE_ROW_PAGE);
  state.counts.workflowRunSteps += steps.length;
  await drain(state, steps, PURGE_ROW_PAGE, (row) => ctx.db.delete(row._id));

  // The tracked links of a closed campaign redirect until the campaign's retention is over; campaigns are few.
  for (const status of ['sent', 'failed'] as const) {
    const closed = await ctx.db
      .query('campaigns')
      .withIndex('by_status', (q) => q.eq('status', status))
      .filter((q) => q.lt(q.field('updatedAt'), eventCutoff))
      .collect();
    for (const campaign of closed) {
      const tokens = await ctx.db
        .query('campaignLinkTokens')
        .withIndex('by_campaign', (q) => q.eq('campaignId', campaign._id))
        .take(PURGE_ROW_PAGE);
      state.counts.campaignLinkTokens += tokens.length;
      await drain(state, tokens, PURGE_ROW_PAGE, (row) => ctx.db.delete(row._id));
    }
  }

  const invitations = await ctx.db
    .query('invitations')
    .withIndex('by_status', (q) => q.eq('status', 'pending'))
    .filter((q) => q.lt(q.field('expiresAt'), now))
    .take(PURGE_ROW_PAGE);
  state.counts.invitations += invitations.length;
  await drain(state, invitations, PURGE_ROW_PAGE, (row) => ctx.db.delete(row._id));

  const keys = await ctx.db
    .query('apiIdempotencyKeys')
    .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
    .take(PURGE_ROW_PAGE);
  state.counts.apiIdempotencyKeys += keys.length;
  await drain(state, keys, PURGE_ROW_PAGE, (row) => ctx.db.delete(row._id));

  const audits = await ctx.db
    .query('auditLogs')
    .withIndex('by_timestamp', (q) => q.lt('timestamp', auditCutoff))
    .take(PURGE_ROW_PAGE);
  state.counts.auditLogs += audits.length;
  await drain(state, audits, PURGE_ROW_PAGE, (row) => ctx.db.delete(row._id));

  return state;
}
