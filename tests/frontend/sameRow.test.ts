import { expect, test } from 'bun:test';
import { sameRow } from '../../src/lib/sameRow';

test('two rows are the same when they hold the same values, whatever objects carry them', () => {
  const row = { _id: 'a', status: 'sent', openedAt: undefined, params: { firstName: 'Ada' } };
  expect(sameRow(row, row)).toBe(true);
  expect(sameRow(row, { ...row, params: { firstName: 'Ada' } })).toBe(true);
  expect(sameRow(row, { ...row, status: 'failed' })).toBe(false);
  expect(sameRow(row, { ...row, openedAt: 1 })).toBe(false);
  expect(sameRow(row, { ...row, params: { firstName: 'Bob' } })).toBe(false);
  expect(sameRow(row, { ...row, error: 'x' })).toBe(false);
  expect(sameRow({ ...row, error: 'x' }, row)).toBe(false);
  expect(sameRow({ a: null }, { a: {} })).toBe(false);
  expect(sameRow({ a: 0 }, { a: -0 })).toBe(false);
});
