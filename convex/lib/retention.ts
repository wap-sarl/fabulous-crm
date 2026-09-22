import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { AttachmentEntityType } from '../_lib/validators/attachments';
import type { RetentionPolicy } from '../_lib/validators/retention';
import { fileStore } from './fileStorage';
import { deleteListMember } from './leadListMembers';

// The nightly purge, one bounded page at a time; features/retention/internal.ts chains the pages.

/** Rows written (deleted or patched) per page, whatever the tables: the one bound the transaction sees. */
export const PURGE_WRITE_BUDGET = 2000;
/** Soft-deleted entities examined per page: each may drag hundreds of related rows along. */
export const PURGE_ENTITY_PAGE = 20;
/** Rows deleted per event table per page. */
export const PURGE_ROW_PAGE = 500;
/** Related rows deleted per table per entity per page; an entity with more waits for the next page. */
export const PURGE_CASCADE_BATCH = 200;
/** Pages a run may chain before it stops and reports itself truncated. */
export const PURGE_MAX_PAGES = 200;
export const DAY_MS = 24 * 60 * 60 * 1000;

const FINISHED_STEPS = [
  'success',
  'failed',
  'skipped_no_consent',
  'skipped_no_email',
  'skipped_no_phone',
  'skipped',
] as const;

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

export interface PageState {
  counts: PurgeCounts;
  /** Writes still allowed on this page. */
  budget: number;
  /** Some table still held rows past a full batch, or the budget ran out: another page is needed. */
  moreLeft: boolean;
}

/** How many rows a query may take: its own cap, never more than the page's remaining budget. */
const room = (state: PageState, cap: number): number => Math.max(0, Math.min(cap, state.budget));

/** Applies `act` to a batch taken with `limit` rows of room; a full batch means the table may hold more. */
async function drain<T>(
  state: PageState,
  rows: T[],
  limit: number,
  act: (row: T) => Promise<void>,
): Promise<boolean> {
  for (const row of rows) await act(row);
  state.budget -= rows.length;
  const full = rows.length >= limit;
  if (full) state.moreLeft = true;
  return full;
}

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
  | 'leadDuplicates';

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
async function purgeLeadRows(ctx: MutationCtx, state: PageState, leadId: Id<'leads'>) {
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

async function purgeCompanyRows(ctx: MutationCtx, state: PageState, companyId: Id<'companies'>) {
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

async function purgeDealRows(ctx: MutationCtx, state: PageState, dealId: Id<'deals'>) {
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

type Trashed = 'leads' | 'companies' | 'deals' | 'activities';

/** The soft-deleted rows of a table past their retention, oldest first; a missing `deletedAt` sorts below any number and stays out. */
const trashOf = (ctx: MutationCtx, table: Trashed, cutoff: number, limit: number) =>
  ctx.db
    .query(table)
    .withIndex('by_deletedAt', (q) => q.gt('deletedAt', 0).lt('deletedAt', cutoff))
    .take(limit);

/** Deletes one batch of aged rows read straight from an index range; nothing is scanned past the batch. */
async function purgeAged(
  ctx: MutationCtx,
  state: PageState,
  key: keyof PurgeCounts,
  query: (limit: number) => Promise<
    {
      _id:
        | Id<'campaignEvents'>
        | Id<'workflowRunSteps'>
        | Id<'campaignLinkTokens'>
        | Id<'invitations'>
        | Id<'apiIdempotencyKeys'>
        | Id<'auditLogs'>;
    }[]
  >,
): Promise<void> {
  const limit = room(state, PURGE_ROW_PAGE);
  if (limit === 0) {
    state.moreLeft = true;
    return;
  }
  const rows = await query(limit);
  state.counts[key] += rows.length;
  await drain(state, rows, limit, (row) => ctx.db.delete(row._id));
}

/**
 * One page of the purge, `at` being the run's reference time: every table gets a share of one write budget,
 * every query reads its rows straight from an index range, and `moreLeft` asks for another page.
 */
export async function purgePage(
  ctx: MutationCtx,
  policy: RetentionPolicy,
  at: number,
): Promise<PageState> {
  const state: PageState = { counts: emptyCounts(), budget: PURGE_WRITE_BUDGET, moreLeft: false };
  const trashCutoff = at - policy.softDeleteDays * DAY_MS;
  const eventCutoff = at - policy.eventDays * DAY_MS;
  const auditCutoff = at - policy.auditDays * DAY_MS;

  for (const lead of await trashOf(ctx, 'leads', trashCutoff, room(state, PURGE_ENTITY_PAGE))) {
    if (state.budget <= 0) break;
    if (await purgeLeadRows(ctx, state, lead._id as Id<'leads'>)) {
      await ctx.db.delete(lead._id);
      state.budget -= 1;
      state.counts.leads += 1;
    }
  }
  for (const company of await trashOf(
    ctx,
    'companies',
    trashCutoff,
    room(state, PURGE_ENTITY_PAGE),
  )) {
    if (state.budget <= 0) break;
    if (await purgeCompanyRows(ctx, state, company._id as Id<'companies'>)) {
      await ctx.db.delete(company._id);
      state.budget -= 1;
      state.counts.companies += 1;
    }
  }
  for (const deal of await trashOf(ctx, 'deals', trashCutoff, room(state, PURGE_ENTITY_PAGE))) {
    if (state.budget <= 0) break;
    if (await purgeDealRows(ctx, state, deal._id as Id<'deals'>)) {
      await ctx.db.delete(deal._id);
      state.budget -= 1;
      state.counts.deals += 1;
    }
  }
  const activityRoom = room(state, PURGE_ENTITY_PAGE);
  const activities = await trashOf(ctx, 'activities', trashCutoff, activityRoom);
  state.counts.activities += activities.length;
  await drain(state, activities, activityRoom, (row) => ctx.db.delete(row._id));
  // Anything still in the trash past its date, left behind by the page or waiting on its cascade, asks for another page.
  for (const table of ['leads', 'companies', 'deals', 'activities'] as const) {
    if ((await trashOf(ctx, table, trashCutoff, 1)).length > 0) state.moreLeft = true;
  }

  await purgeAged(ctx, state, 'campaignEvents', (limit) =>
    ctx.db
      .query('campaignEvents')
      .withIndex('by_eventAt', (q) => q.lt('eventAt', eventCutoff))
      .take(limit),
  );
  // A step still pending belongs to a run still parked on it, whatever its age: only finished outcomes are read.
  for (const status of FINISHED_STEPS) {
    await purgeAged(ctx, state, 'workflowRunSteps', (limit) =>
      ctx.db
        .query('workflowRunSteps')
        .withIndex('by_status_startedAt', (q) =>
          q.eq('status', status).lt('startedAt', eventCutoff),
        )
        .take(limit),
    );
  }
  // The tracked links of a closed campaign redirect until the campaign's retention is over; campaigns are few.
  for (const status of ['sent', 'failed'] as const) {
    const closed = await ctx.db
      .query('campaigns')
      .withIndex('by_status_updatedAt', (q) => q.eq('status', status).lt('updatedAt', eventCutoff))
      .collect();
    for (const campaign of closed) {
      if (state.budget <= 0) {
        state.moreLeft = true;
        break;
      }
      await purgeAged(ctx, state, 'campaignLinkTokens', (limit) =>
        ctx.db
          .query('campaignLinkTokens')
          .withIndex('by_campaign', (q) => q.eq('campaignId', campaign._id))
          .take(limit),
      );
    }
  }
  // An invitation without an expiry sorts below any number in the index and stays.
  await purgeAged(ctx, state, 'invitations', (limit) =>
    ctx.db
      .query('invitations')
      .withIndex('by_status_expiresAt', (q) =>
        q.eq('status', 'pending').gt('expiresAt', 0).lt('expiresAt', at),
      )
      .take(limit),
  );
  await purgeAged(ctx, state, 'apiIdempotencyKeys', (limit) =>
    ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', at))
      .take(limit),
  );
  await purgeAged(ctx, state, 'auditLogs', (limit) =>
    ctx.db
      .query('auditLogs')
      .withIndex('by_timestamp', (q) => q.lt('timestamp', auditCutoff))
      .take(limit),
  );
  return state;
}
