/** The aggregates sort live rows under key 0 and deleted ones under 1: these bounds count the live ones. */
export const LIVE_BOUNDS = {
  lower: { key: 0 as const, inclusive: true },
  upper: { key: 0 as const, inclusive: true },
};

/** Where an aggregate keeps a row: its namespace, its key and what it adds to the sum. */
type Place<Row> = {
  namespace?: (row: Row) => unknown;
  sortKey: (row: Row) => unknown;
  sumValue?: (row: Row) => number;
};

type RowChange<Row> = {
  operation: 'insert' | 'update' | 'delete';
  oldDoc: Row | null;
  newDoc: Row | null;
};

/** The trigger that keeps an aggregate, without the update that leaves the row where it is: most writes of a row change neither its namespace, its key nor its sum, and replacing it in the tree all the same is what a write costs most. */
export function whenMoved<Row, Ctx, Change extends RowChange<Row>>(
  trigger: (ctx: Ctx, change: Change) => Promise<void>,
  place: Place<Row>,
): (ctx: Ctx, change: Change) => Promise<void> {
  const at = (row: Row) =>
    JSON.stringify([place.namespace?.(row) ?? null, place.sortKey(row), place.sumValue?.(row)]);
  return async (ctx, change) => {
    const { oldDoc, newDoc } = change;
    if (change.operation === 'update' && oldDoc && newDoc && at(oldDoc) === at(newDoc)) return;
    await trigger(ctx, change);
  };
}
