import { v } from 'convex/values';

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
  'importRows',
  'importJobs',
  'pageViews',
  'webVisitors',
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
// A run started before a key existed carries counts without it.
export const addCounts = (a: PurgeCounts, b: PurgeCounts): PurgeCounts =>
  Object.fromEntries(
    PURGE_COUNT_KEYS.map((key) => [key, (a[key] ?? 0) + (b[key] ?? 0)]),
  ) as PurgeCounts;

export const newPageState = (): PageState => ({
  counts: emptyCounts(),
  budget: PURGE_WRITE_BUDGET,
  moreLeft: false,
});

export interface PageState {
  counts: PurgeCounts;
  /** Writes still allowed on this page. */
  budget: number;
  /** Some table still held rows past a full batch, or the budget ran out: another page is needed. */
  moreLeft: boolean;
}

/** How many rows a query may take: its own cap, never more than the page's remaining budget. */
export const room = (state: PageState, cap: number): number =>
  Math.max(0, Math.min(cap, state.budget));

/** Applies `act` to a batch taken with `limit` rows of room; a full batch means the table may hold more. */
export async function drain<T>(
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
