import type { IndexRange, PaginationOptions, PaginationResult } from 'convex/server';

/** Window on a source's sort key: rows with `from <= key < before`. */
export interface TimelineWindow {
  before?: number;
  from?: number;
}

/** A row read from a source: its sort key, and how to turn it into an event once emitted. */
export interface TimelineRow<E> {
  at: number;
  /** Resolved only for emitted rows. `null` drops the row (e.g. soft-deleted). */
  build: () => Promise<E | null>;
}

export interface TimelineSource<E> {
  kind: string;
  /** Rows inside `window`, newest first; at most `limit` when given. */
  load: (window: TimelineWindow, limit?: number) => Promise<TimelineRow<E>[]>;
}

interface TimelineCursor {
  before?: number;
  done: string[];
}

function decodeCursor(cursor: string | null): TimelineCursor {
  if (!cursor) return { done: [] };
  try {
    const parsed = JSON.parse(cursor) as Partial<TimelineCursor>;
    return {
      before: typeof parsed.before === 'number' ? parsed.before : undefined,
      done: Array.isArray(parsed.done) ? parsed.done.filter((k) => typeof k === 'string') : [],
    };
  } catch {
    throw new Error('timeline_invalid_cursor');
  }
}

function encodeCursor(cursor: TimelineCursor): string {
  return JSON.stringify(cursor);
}

/** The bounds an index range builder offers on a numeric sort field. */
interface WindowableRange extends IndexRange {
  gte(field: string, value: number): WindowableUpperRange;
  lt(field: string, value: number): IndexRange;
}
interface WindowableUpperRange extends IndexRange {
  lt(field: string, value: number): IndexRange;
}

/** Narrow an index range to `window` on its sort field (the trailing index field). */
export function withinWindow(
  range: WindowableRange,
  field: string,
  window: TimelineWindow,
): IndexRange {
  const lower = window.from !== undefined ? range.gte(field, window.from) : range;
  return window.before !== undefined ? lower.lt(field, window.before) : lower;
}

const MAX_PAGE = 100;

export async function paginateTimeline<E extends { at: number }>(
  sources: TimelineSource<E>[],
  opts: PaginationOptions,
): Promise<PaginationResult<E>> {
  const start = decodeCursor(opts.cursor);
  const active = sources.filter((s) => !start.done.includes(s.kind));
  if (active.length === 0) {
    return { page: [], isDone: true, continueCursor: opts.cursor ?? encodeCursor(start) };
  }
  const order = new Map(sources.map((s, i) => [s.kind, i]));
  const byTime = (a: { at: number; kind: string }, b: { at: number; kind: string }) =>
    b.at - a.at || (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0);

  // Re-read of a pinned page: exactly the rows the page emitted the first time.
  if (opts.endCursor) {
    const end = decodeCursor(opts.endCursor);
    const rows = (
      await Promise.all(
        active.map(async (s) => {
          const from = end.done.includes(s.kind) ? undefined : end.before;
          const loaded = await s.load({ before: start.before, from });
          return loaded.map((row) => ({ kind: s.kind, ...row }));
        }),
      )
    )
      .flat()
      .sort(byTime);
    return {
      page: await buildAll(rows),
      isDone: active.every((s) => end.done.includes(s.kind)),
      continueCursor: opts.endCursor,
    };
  }

  const numItems = Math.min(Math.max(1, opts.numItems), MAX_PAGE);
  const loaded = await Promise.all(
    active.map(async (s) => {
      const rows = await s.load({ before: start.before }, numItems);
      return { kind: s.kind, rows, exhausted: rows.length < numItems };
    }),
  );

  const frontier = Math.max(
    Number.NEGATIVE_INFINITY,
    ...loaded.filter((l) => !l.exhausted).map((l) => l.rows[l.rows.length - 1].at),
  );
  const safe = loaded
    .flatMap((l) => l.rows.map((row) => ({ kind: l.kind, ...row })))
    .sort(byTime)
    .filter((row) => row.at >= frontier);

  // Trim to the page size, keeping a tie on the cut whole so `before` stays exclusive.
  let cut = Math.min(numItems, safe.length);
  while (cut > 0 && cut < safe.length && safe[cut].at === safe[cut - 1].at) cut++;
  const emitted = safe.slice(0, cut);
  const before = emitted.length > 0 ? emitted[emitted.length - 1].at : start.before;

  // A source is finished once it ran dry and every row it returned was emitted.
  const done = [
    ...start.done,
    ...loaded
      .filter((l) => l.exhausted && l.rows.every((r) => before === undefined || r.at >= before))
      .map((l) => l.kind),
  ];
  return {
    page: await buildAll(emitted),
    isDone: active.every((s) => done.includes(s.kind)),
    continueCursor: encodeCursor({ before, done }),
  };
}

async function buildAll<E>(rows: TimelineRow<E>[]): Promise<E[]> {
  const built = (await Promise.all(rows.map((row) => row.build()))) as (E | null)[];
  return built.filter((e): e is E => e !== null);
}
