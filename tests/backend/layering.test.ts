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
    const lowest = [
      ...filesOf(join(ROOT, '_lib/validators')),
      join(ROOT, '_lib/time.ts'),
      join(ROOT, '_lib/text.ts'),
      join(ROOT, '_lib/refusal.ts'),
    ];
    expect(upward(lowest, /\/convex\/(lib|features)\//)).toEqual([]);
  });

  test('shared code imports no feature', () => {
    expect(upward(filesOf(join(ROOT, 'lib')), /\/convex\/features\//)).toEqual([]);
  });
});

/** The files whose functions have no database of their own (actions, HTTP routes, the sign-in hooks): running a query is how they read. */
const WITHOUT_DATABASE =
  /(^|\/)(actions|routes)\.ts$|^auth\.ts$|^_lib\/auth\.ts$|^lib\/api\/routeTable\.ts$/;

/** The internal queries a query or a mutation may run, each with the reason it reads past the caller's row-level rules. */
const PAST_THE_RULES: Record<string, string> = {
  'internal.features.leadLists.internal.dynamicListLimits':
    'the cap of dynamic lists is the deployment’s: it counts the lists the caller cannot see, and returns two numbers',
};

describe('the row-level rules', () => {
  test('a query or a mutation reads through its own database; what it runs past the rules is listed, with the reason', () => {
    const run = filesOf(ROOT)
      .map((file) => file.slice(ROOT.length + 1))
      .filter((file) => !file.startsWith('_generated/') && !WITHOUT_DATABASE.test(file))
      .flatMap((file) =>
        [...readFileSync(join(ROOT, file), 'utf8').matchAll(/\brunQuery\(\s*([\w.]+)/g)].map(
          (m) => `${file} -> ${m[1]}`,
        ),
      );
    expect(run.sort()).toEqual([
      'features/leadLists/mutations.ts -> internal.features.leadLists.internal.dynamicListLimits',
      'features/leadLists/queries.ts -> internal.features.leadLists.internal.dynamicListLimits',
    ]);
    for (const line of run) expect(PAST_THE_RULES).toHaveProperty([line.split(' -> ')[1]]);
  });

  test('what the wrappers hand to a function is listed by name: the session, the visibility, and `db`, the scoped one', () => {
    const auth = readFileSync(join(ROOT, '_lib/auth.ts'), 'utf8');
    // Every object the file returns, by its keys: a helper around `ctx.db` under a new name shows here whatever it is called.
    const returned = [...auth.matchAll(/return \{([^{}]*)\}/g)].map((m) =>
      m[1]
        .replace(/\([^()]*\)/g, '')
        .split(',')
        .map((entry) => entry.split(':')[0].trim())
        .filter(Boolean),
    );
    expect(returned).toEqual([
      ['userId', 'user'],
      ['...session', 'visibility', 'db'],
      ['...session', 'visibility'],
      ['...session', 'db'],
      ['...session', 'visibility', 'db'],
      ['...session', 'db'],
      [],
    ]);
    expect(auth.match(/\breturn\b(?! (?:null|session);)/g)).toHaveLength(returned.length);
    const scoped = [...auth.matchAll(/\bdb: (\w+)\(ctx, (?:session\.)?visibility\)/g)].map(
      (m) => m[1],
    );
    expect(scoped).toEqual(['scopedReader', 'scopedReader', 'scopedWriter', 'scopedWriter']);
  });
});
