/** What an overlay adds to the lists two guard tests keep, each entry with its reason. Empty here: an overlay replaces this file with its own (docs/extensions.md). */
export const overlayRules: {
  /** Reads of a whole table or index range, as `table` or `table.index` (tests/backend/collects.test.ts). */
  smallReads: Record<string, string>;
  /** Queries run from a query or a mutation, as `file -> reference` (tests/backend/layering.test.ts). */
  queriesRun: Record<string, string>;
} = { smallReads: {}, queriesRun: {} };
