import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '../../convex');
const BUILDERS =
  /^(internal)?(Query|Mutation|Action)$|^(query|mutation|action|employee(Query|Mutation)|settings(Query|Mutation))$/;

/** The functions that declare no `returns`, each with the reason a validator cannot say what they give. */
const OPEN: Record<string, string> = {
  'features/config/queries.ts:getPublicConfig':
    'an overlay adds its own fields (extensions.publicConfig), and a validator of an object is closed',
};

function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourcesOf(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Every Convex function of a file, with what its definition declares. */
function functionsOf(path: string): { name: string; declares: Set<string> }[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: { name: string; declares: Set<string> }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      BUILDERS.test(node.expression.text) &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0]) &&
      ts.isVariableDeclaration(node.parent)
    ) {
      const declares = new Set(node.arguments[0].properties.map((p) => p.name?.getText() ?? ''));
      if (declares.has('handler')) found.push({ name: node.parent.name.getText(), declares });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const all = sourcesOf(ROOT).flatMap((path) =>
  functionsOf(path).map((fn) => ({ ...fn, id: `${path.slice(ROOT.length + 1)}:${fn.name}` })),
);

test('every Convex function declares what it takes and what it returns, or says why it cannot', () => {
  expect(all.length).toBeGreaterThan(250);
  expect(all.filter((fn) => !fn.declares.has('args')).map((fn) => fn.id)).toEqual([]);
  expect(
    all.filter((fn) => !fn.declares.has('returns') && !(fn.id in OPEN)).map((fn) => fn.id),
  ).toEqual([]);
});

test('an exception is still needed: the function still declares no `returns`', () => {
  const declared = new Set(all.filter((fn) => fn.declares.has('returns')).map((fn) => fn.id));
  expect(Object.keys(OPEN).filter((id) => declared.has(id))).toEqual([]);
});
