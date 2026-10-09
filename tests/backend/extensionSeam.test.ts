import { describe, expect, test } from 'bun:test';
import { extensions as installed, setExtensionsForTests } from '../../convex/extensions';
import { defaultExtensions } from '../../convex/lib/extensions/types';
import { backendStandIn } from '../support/backendStandIn';

const ctx = {} as never;

describe('the backend hooks a test runs with', () => {
  test('the suite runs with the stand-in when asked to, with the file otherwise', async () => {
    // Were the stand-in not in place, the run would pass for the wrong reason. Without it the file may be an overlay's, with answers of its own.
    const config = await installed.publicConfig(ctx);
    if (process.env.OVERLAY_STAND_IN)
      expect(config).toEqual(await backendStandIn.publicConfig(ctx));
    else expect(config).not.toHaveProperty('standIn');
  });

  test('a test says them: the core alone, the core with a hook, and back to what is installed', async () => {
    const before = await installed.publicConfig(ctx);
    setExtensionsForTests(defaultExtensions);
    expect(await installed.publicConfig(ctx)).toEqual({});
    setExtensionsForTests({ publicConfig: async () => ({ hook: true }) });
    expect(await installed.publicConfig(ctx)).toEqual({ hook: true });
    setExtensionsForTests(null);
    expect(await installed.publicConfig(ctx)).toEqual(before);
  });

  // Two tests that each leave something behind: whichever runs second finds what is installed, in any order.
  for (const name of ['first', 'second']) {
    test(`what a test set does not outlive it (${name})`, async () => {
      expect(await installed.publicConfig(ctx)).not.toEqual({ left: expect.any(String) });
      setExtensionsForTests({ publicConfig: async () => ({ left: name }) });
      expect(await installed.publicConfig(ctx)).toEqual({ left: name });
    });
  }
});
