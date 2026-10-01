import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const MAX_LINES = 400;

/** The files allowed over the limit, each with the reason it is better left whole. */
const EXCEPTIONS: Record<string, string> = {
  'convex/schema.ts':
    'one list of the tables: split, the data model is no longer read in one place',
  'src/features/workflows/lib/constants.ts': 'a table of labels',
  'src/pages/design-system/DesignSystemPage.tsx': 'a showcase of the components, not a feature',
};

function sourcesOf(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourcesOf(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.generated.') ? [path] : [];
  });
}

const linesOf = (path: string) => readFileSync(join(ROOT, path), 'utf8').split('\n').length - 1;

test(`a hand-written source file holds ${MAX_LINES} lines at most, or says why it holds more`, () => {
  const tooLong = [...sourcesOf('convex'), ...sourcesOf('src')]
    .map((path) => relative('.', path))
    .filter((path) => linesOf(path) > MAX_LINES && !(path in EXCEPTIONS))
    .map((path) => `${path} (${linesOf(path)})`);
  expect(tooLong).toEqual([]);
});

test('an exception is still needed: the file is still over the limit', () => {
  const stale = Object.keys(EXCEPTIONS).filter((path) => linesOf(path) <= MAX_LINES);
  expect(stale).toEqual([]);
});
