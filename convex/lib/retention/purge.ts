import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { RetentionPolicy } from '../../_lib/validators/retention';
import { scheduleViewRefresh } from '../tracking/views';
import { DAY_MS } from '../../_lib/time';
import {
  PURGE_WRITE_BUDGET,
  PURGE_ENTITY_PAGE,
  PURGE_ROW_PAGE,
  type PurgeCounts,
  emptyCounts,
  type PageState,
  room,
  drain,
} from './budget';
import { purgeLeadRows, purgeCompanyRows, purgeDealRows } from './rows';

const FINISHED_STEPS = [
  'success',
  'failed',
  'skipped_no_consent',
  'skipped_no_email',
  'skipped_no_phone',
  'skipped',
] as const;

type Trashed = 'leads' | 'companies' | 'deals' | 'activities' | 'forms';

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
        | Id<'importRows'>
        | Id<'webVisitors'>
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

/** One page of the purge, `at` being the run's reference time: every table gets a share of one write budget, and `moreLeft` asks for another page. */
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
  // A deleted form is a definition; its submissions belong to their contacts and follow them.
  for (const form of await trashOf(ctx, 'forms', trashCutoff, room(state, PURGE_ENTITY_PAGE))) {
    if (state.budget <= 0) break;
    await ctx.db.delete(form._id);
    state.budget -= 1;
    state.counts.related += 1;
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
  // A finished import keeps its rows in error (the file's cells) for the report; they go with the events.
  for (const status of ['done', 'cancelled'] as const) {
    const finished = await ctx.db
      .query('importJobs')
      .withIndex('by_status_finishedAt', (q) =>
        q.eq('status', status).gt('finishedAt', 0).lt('finishedAt', eventCutoff),
      )
      .take(PURGE_ENTITY_PAGE);
    for (const job of finished) {
      if (state.budget <= 0) {
        state.moreLeft = true;
        break;
      }
      await purgeAged(ctx, state, 'importRows', (limit) =>
        ctx.db
          .query('importRows')
          .withIndex('by_job_index', (q) => q.eq('jobId', job._id))
          .take(limit),
      );
      if (state.moreLeft) break;
      await ctx.db.delete(job._id);
      state.budget -= 1;
      state.counts.importJobs += 1;
    }
  }
  // Page views and idle browsers past the tracking retention (appConfig.tracking, its own duration).
  const trackingCutoff = at - policy.trackingDays * DAY_MS;
  const viewRoom = room(state, PURGE_ROW_PAGE);
  if (viewRoom === 0) state.moreLeft = true;
  else {
    const views = await ctx.db
      .query('pageViews')
      .withIndex('by_at', (q) => q.lt('at', trackingCutoff))
      .take(viewRoom);
    state.counts.pageViews += views.length;
    await drain(state, views, viewRoom, (row) => ctx.db.delete(row._id));
    // What the contact shows of its visits follows: the filters stop matching pages whose views are gone.
    await scheduleViewRefresh(ctx, views);
  }
  await purgeAged(ctx, state, 'webVisitors', (limit) =>
    ctx.db
      .query('webVisitors')
      .withIndex('by_lastSeenAt', (q) => q.lt('lastSeenAt', trackingCutoff))
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
