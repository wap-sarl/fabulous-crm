import { afterEach, jest } from 'bun:test';
import { closeBackends } from './support/backends';
import { refuseNetwork, takeRefused } from './support/network';

globalThis.fetch = refuseNetwork;

afterEach(async () => {
  await closeBackends();
  jest.useRealTimers();
  const refused = takeRefused();
  if (refused.length > 0) {
    throw new Error(`the test reached the network:\n${refused.join('\n')}`);
  }
});
