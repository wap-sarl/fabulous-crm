import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { overlayRules } from '../support/overlayRules';

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

/** The files whose helpers are only called without a database of their own (HTTP routes, the sign-in hooks): running a query is how they read. */
const WITHOUT_DATABASE = /(^|\/)routes\.ts$|^auth\.ts$|^_lib\/auth\.ts$|^lib\/api\/routeTable\.ts$/;

/** The queries a file runs from anything but an action: a call is the action's when the declaration it sits in is one (`export const send = internalAction({`). */
function queriesRunOutsideActions(source: string): string[] {
  const lines = source.split('\n');
  return lines.flatMap((line, at) => {
    const reference = /\brunQuery\(\s*([\w.]+)/.exec(line)?.[1];
    // A call broken over two lines names its query on the next one.
    const named =
      reference ??
      (/\brunQuery\(\s*$/.test(line) ? lines[at + 1]?.trim().replace(/,$/, '') : undefined);
    if (!named) return [];
    const declaration = lines
      .slice(0, at + 1)
      .reverse()
      .find((above) => /^(export )?(const|function|async function) /.test(above));
    const builder = /^(?:export )?const \w+ = (\w+)\(/.exec(declaration ?? '')?.[1];
    return builder && /action$/i.test(builder) ? [] : [named];
  });
}

/** The internal queries a query or a mutation may run, each with the reason it reads past the caller's row-level rules. */
const PAST_THE_RULES: Record<string, string> = {
  'internal.features.leadLists.internal.dynamicListLimits':
    'the cap of dynamic lists is the deployment’s: it counts the lists the caller cannot see, and returns two numbers',
};

const CORE_QUERIES_RUN = [
  'features/leadLists/mutations.ts -> internal.features.leadLists.internal.dynamicListLimits',
  'features/leadLists/queries.ts -> internal.features.leadLists.internal.dynamicListLimits',
];

describe('the row-level rules', () => {
  test('a query run from an action is the action’s; from a query, a mutation or a helper it is counted', () => {
    const source = [
      'export const send = internalAction({',
      '  handler: async (ctx) => {',
      '    await ctx.runQuery(internal.a.fromAnAction, {});',
      '  },',
      '});',
      'export const list = employeeQuery({',
      '  handler: (ctx) => ctx.runQuery(internal.a.fromAQuery, {}),',
      '});',
      'export const save = internalMutation({',
      '  handler: async (ctx) => {',
      '    await ctx.runQuery(',
      '      fromAMutationRef,',
      '      {},',
      '    );',
      '  },',
      '});',
      'async function helper(ctx: Ctx) {',
      '  return await ctx.runQuery(internal.a.fromAHelper, {});',
      '}',
      'export const hooks = {',
      '  check: (ctx: Ctx) => ctx.runQuery(fromAHookRef, {}),',
      '};',
      'export const page = httpAction(async (ctx) => ctx.runQuery(internal.a.fromAnHttpAction, {}));',
    ].join('\n');
    expect(queriesRunOutsideActions(source)).toEqual([
      'internal.a.fromAQuery',
      'fromAMutationRef',
      'internal.a.fromAHelper',
      'fromAHookRef',
    ]);
  });

  test('a query or a mutation reads through its own database; what it runs past the rules is listed, with the reason', () => {
    const run = filesOf(ROOT)
      .map((file) => file.slice(ROOT.length + 1))
      .filter((file) => !file.startsWith('_generated/') && !WITHOUT_DATABASE.test(file))
      .flatMap((file) =>
        queriesRunOutsideActions(readFileSync(join(ROOT, file), 'utf8')).map(
          (reference) => `${file} -> ${reference}`,
        ),
      );
    // An overlay lists its own, with its reasons, in the file it replaces; a reason that excuses nothing is removed.
    const ofOverlay = Object.keys(overlayRules.queriesRun);
    expect(ofOverlay.filter((line) => !run.includes(line))).toEqual([]);
    // The core's own are listed here and nowhere else: an overlay cannot take one of them over, and each of its entries says why.
    expect(ofOverlay.filter((line) => CORE_QUERIES_RUN.includes(line))).toEqual([]);
    expect(Object.values(overlayRules.queriesRun).filter((reason) => !reason.trim())).toEqual([]);
    const ofCore = run.filter((line) => !ofOverlay.includes(line));
    expect(ofCore.sort()).toEqual(CORE_QUERIES_RUN);
    for (const line of ofCore) expect(PAST_THE_RULES).toHaveProperty([line.split(' -> ')[1]]);
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
