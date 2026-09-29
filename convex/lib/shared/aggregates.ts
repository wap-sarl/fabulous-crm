/** The aggregates sort live rows under key 0 and deleted ones under 1: these bounds count the live ones. */
export const LIVE_BOUNDS = {
  lower: { key: 0 as const, inclusive: true },
  upper: { key: 0 as const, inclusive: true },
};
