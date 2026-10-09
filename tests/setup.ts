import { afterEach, jest, mock } from 'bun:test';
import { join } from 'node:path';
import { endTest } from './support/teardown';
import { refuseNetwork, takeRefused } from './support/network';
import { overlayStandIn } from './support/overlayStandIn';

globalThis.fetch = refuseNetwork;

// `bun run test:stand-in`: the file an overlay replaces is replaced here too, before anything imports it.
if (process.env.OVERLAY_STAND_IN) {
  mock.module(join(import.meta.dir, '../src/extensions.tsx'), () => ({
    extensions: overlayStandIn,
  }));
  mock.module(
    join(import.meta.dir, '../convex/extensions.ts'),
    () => import('./support/backendStandIn'),
  );
}

afterEach(async () => {
  // Dynamic, after the stand-ins are in place: every test starts from the installed extensions, whatever the one before it set.
  const { setFrontendExtensionsForTests } = await import('../src/lib/frontendExtensions');
  const { setExtensionsForTests } = await import('../convex/extensions');
  setFrontendExtensionsForTests(null);
  setExtensionsForTests(null);
  await endTest();
  jest.useRealTimers();
  const refused = takeRefused();
  if (refused.length > 0) {
    throw new Error(`the test reached the network:\n${refused.join('\n')}`);
  }
});
