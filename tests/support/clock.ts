import { jest } from 'bun:test';

/** A backend test runs on a clock that only the test moves: nothing scheduled fires by itself. */
interface Schedulable {
  finishAllScheduledFunctions: (advanceTimers: () => void) => Promise<void>;
  run: <R>(read: (ctx: SchedulerReader) => Promise<R>) => Promise<R>;
}

interface SchedulerReader {
  db: {
    system: {
      query: (table: '_scheduled_functions') => {
        collect: () => Promise<{ state: { kind: string }; scheduledTime: number }[]>;
      };
    };
  };
}

/** The rounds `runDue` gives a chain of scheduled work before calling it endless. */
const MAX_ROUNDS = 100;

const dueLeft = (t: Schedulable): Promise<boolean> =>
  t.run(async (ctx) => {
    const jobs = await ctx.db.system.query('_scheduled_functions').collect();
    return jobs.some(
      (job) => job.state.kind === 'pending' && Math.floor(job.scheduledTime) <= Date.now(),
    );
  });

/** Runs the scheduled work that is due now, and what it schedules for now, until none is left. */
export async function runDue(t: Schedulable): Promise<void> {
  // convex-test stops at the first advance that leaves nothing in flight: a function that ran to its end inside the advance and scheduled the next for now is left behind, so the rounds go on while work is due.
  for (let round = 0; round < MAX_ROUNDS; round++) {
    await t.finishAllScheduledFunctions(() => jest.advanceTimersByTime(0));
    if (!(await dueLeft(t))) return;
  }
  throw new Error(`runDue: scheduled work is still due after ${MAX_ROUNDS} rounds`);
}

const realRandom = Math.random;

/** What `Math.random` answers while a test runs: a fixed value, so that a delay with a share of chance on top is one the test can advance to (zero: no jitter), or a sequence of the test's own, for a spread it can replay. Undone after each test. */
export function pinDice(value: number | (() => number)): void {
  Math.random = typeof value === 'number' ? () => value : value;
}

/** A sequence that looks like chance and replays the same: for a test about a spread. */
export function loadedDice(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Back to chance, for a test about it. */
export function unpinDice(): void {
  Math.random = realRandom;
}

/** A date for the test to start from. */
export function pinClock(now: number): void {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));
}

/** Runs everything scheduled, whenever it is due: for chains that end. Running timers moves the date: `backTo` puts it back. */
export async function runAll(t: Schedulable, backTo?: number): Promise<void> {
  await t.finishAllScheduledFunctions(() => jest.runAllTimers());
  if (backTo !== undefined) jest.setSystemTime(new Date(backTo));
}

/** Moves the clock forward, then runs what became due. */
export async function runAfter(t: Schedulable, ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await runDue(t);
}
