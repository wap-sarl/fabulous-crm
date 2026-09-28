import { jest } from 'bun:test';

/** A backend test runs on a clock that only the test moves: nothing scheduled fires by itself. */
interface Schedulable {
  finishAllScheduledFunctions: (advanceTimers: () => void) => Promise<void>;
}

/** Runs the scheduled work that is due now, and what it schedules for now, until none is left. */
export const runDue = (t: Schedulable): Promise<void> =>
  t.finishAllScheduledFunctions(() => jest.advanceTimersByTime(0));

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
