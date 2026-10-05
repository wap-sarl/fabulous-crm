import { describe, expect, test } from 'bun:test';
import { shouldReloadForBuild } from '../../src/lib/buildReload';

function storage(broken = false) {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => {
      if (broken) throw new Error('storage is off');
      return kept.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      kept.set(key, value);
    },
  };
}

describe('a page whose file is gone after a deployment', () => {
  test('loads the new build, once for each build the tab was on', () => {
    const tab = storage();
    // The tab is on build A when B is deployed: it reloads, and lands on B.
    expect(shouldReloadForBuild(tab, 'A')).toBe(true);
    // Left open until C is deployed: B gets its reload too.
    expect(shouldReloadForBuild(tab, 'B')).toBe(true);
  });

  test('does not loop when the file is missing from the build it reloaded onto', () => {
    const tab = storage();
    expect(shouldReloadForBuild(tab, 'A')).toBe(true);
    // The reload came back on the same build: the file is really missing.
    expect(shouldReloadForBuild(tab, 'A')).toBe(false);
    expect(shouldReloadForBuild(tab, 'A')).toBe(false);
  });

  test('does not reload when nothing can remember that it did', () => {
    expect(shouldReloadForBuild(storage(true), 'A')).toBe(false);
  });
});
