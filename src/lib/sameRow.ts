/** Whether two rows of a live query say the same thing: every update hands new objects, also for the rows that did not change, so a memoised row compares what they hold. Values by identity, nested ones by their JSON. */
export function sameRow(a: object, b: object): boolean {
  if (a === b) return true;
  const before = a as Record<string, unknown>;
  const after = b as Record<string, unknown>;
  const keys = Object.keys(before);
  if (keys.length !== Object.keys(after).length) return false;
  return keys.every((key) => {
    const x = before[key];
    const y = after[key];
    if (Object.is(x, y)) return true;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
    return JSON.stringify(x) === JSON.stringify(y);
  });
}
