import { expect, test } from 'bun:test';
import { inheritKey, keyOf } from '../../src/features/filters/lib/rowKeys';

test('a row keeps its key through its edits, and two rows that hold the same never share one', () => {
  const first = { field: 'email', operator: 'contains' };
  const second = { field: 'email', operator: 'contains' };
  expect(keyOf(first)).toBe(keyOf(first));
  expect(keyOf(second)).not.toBe(keyOf(first));

  const edited = inheritKey(first, { ...first, value: 'ada' });
  expect(edited).toEqual({ field: 'email', operator: 'contains', value: 'ada' });
  expect(keyOf(edited)).toBe(keyOf(first));
  // Edited again before it was ever shown: the key still follows.
  expect(keyOf(inheritKey(edited, { ...edited, value: 'adb' }))).toBe(keyOf(first));
  // The second row, removed and typed again from scratch, is a new row.
  expect(keyOf({ ...second })).not.toBe(keyOf(second));
});
