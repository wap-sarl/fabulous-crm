import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { extensions as installed } from '../../src/extensions';
import {
  defaultFrontendExtensions,
  frontendExtensions,
  setFrontendExtensionsForTests,
} from '../../src/lib/frontendExtensions';
import { overlayStandIn } from '../support/overlayStandIn';

const SRC = join(import.meta.dir, '../../src');

function sources(dir: string): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the frontend extensions a test runs with', () => {
  test('the suite runs with the stand-in when asked to, with the file otherwise', () => {
    // The stand-in replaces the file before anything imports it: were it not in place, the run would pass for the wrong reason.
    if (process.env.OVERLAY_STAND_IN) expect(installed).toBe(overlayStandIn);
    else expect(installed).not.toBe(overlayStandIn);
    expect(Object.isFrozen(overlayStandIn)).toBe(true);
  });

  test('a test says them: the core alone, the core with a hook, and back to what is installed', () => {
    expect(frontendExtensions()).toBe(installed);

    setFrontendExtensionsForTests({});
    expect(frontendExtensions()).toEqual(defaultFrontendExtensions);
    expect(frontendExtensions()).toEqual({ routes: [], navItems: [], ShellGuard: null });

    const describeRefusal = () => 'worded';
    setFrontendExtensionsForTests({ describeRefusal });
    expect(frontendExtensions()).toEqual({ ...defaultFrontendExtensions, describeRefusal });
    // Each call starts from the defaults, not from the call before.
    setFrontendExtensionsForTests({ loginMethods: () => null });
    expect(frontendExtensions().describeRefusal).toBeUndefined();

    setFrontendExtensionsForTests(null);
    expect(frontendExtensions()).toBe(installed);
  });

  // Two tests that each leave something behind: whichever runs second finds what is installed, in any order.
  for (const name of ['first', 'second']) {
    test(`what a test set does not outlive it (${name})`, () => {
      expect(frontendExtensions()).toBe(installed);
      setFrontendExtensionsForTests({ describeRefusal: () => name });
      expect(frontendExtensions().describeRefusal?.({ code: 'x', data: {} })).toBe(name);
    });
  }

  test('the accessor reads the installed extensions when it is called, never when it loads: an overlay imports the core, which imports the accessor', () => {
    const file = join(SRC, 'lib/frontendExtensions.ts');
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    // Every use of the import outside a function would run in the middle of that cycle, before the overlay's file has defined anything.
    const atLoad: number[] = [];
    const visit = (node: ts.Node, inFunction: boolean) => {
      if (ts.isImportDeclaration(node)) return;
      if (ts.isIdentifier(node) && node.text === 'installed' && !inFunction) {
        atLoad.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      node.forEachChild((child) => visit(child, inFunction || ts.isFunctionLike(node)));
    };
    visit(source, false);
    expect(atLoad).toEqual([]);
    expect(source.text).toContain('installed');
  });

  test('the core reads its extensions through the accessor: one file imports the one an overlay replaces', () => {
    const readers = sources('.').filter((file) =>
      /from\s+['"](?:\.{1,2}\/)+extensions['"]/.test(readFileSync(join(SRC, file), 'utf8')),
    );
    expect(readers).toEqual(['lib/frontendExtensions.ts']);
  });
});
