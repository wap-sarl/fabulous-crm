import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../convex');

function filesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesOf(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)].map((m) => join(file, '..', m[1]));

const upward = (files: string[], above: RegExp) =>
  files.flatMap((file) =>
    importsOf(file)
      .filter((target) => above.test(target))
      .map((target) => `${file.slice(ROOT.length + 1)} -> ${target.slice(ROOT.length + 1)}`),
  );

describe('the layers of the backend', () => {
  test('the validators and the constants are the lowest: they import neither shared code nor a feature', () => {
    const lowest = [...filesOf(join(ROOT, '_lib/validators')), join(ROOT, '_lib/time.ts')];
    expect(upward(lowest, /\/convex\/(lib|features)\//)).toEqual([]);
  });

  test('shared code imports no feature', () => {
    expect(upward(filesOf(join(ROOT, 'lib')), /\/convex\/features\//)).toEqual([]);
  });
});
