import { afterEach, jest } from 'bun:test';
import { endTest } from './support/teardown';
import { refuseNetwork, takeRefused } from './support/network';

globalThis.fetch = refuseNetwork;

afterEach(async () => {
  await endTest();
  jest.useRealTimers();
  const refused = takeRefused();
  if (refused.length > 0) {
    throw new Error(`the test reached the network:\n${refused.join('\n')}`);
  }
});
