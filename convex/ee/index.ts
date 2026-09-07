import { EDITION_REQUIRED, type EeBackend, type EeFeature } from '../../ee/contract';

export const eeBackend: EeBackend = { bundled: false, features: [] };

/** Every paid entry point goes through here so a community build fails with one stable code. */
export function requireEeModule(feature: EeFeature): never {
  throw new Error(`${EDITION_REQUIRED}: ${feature}`);
}
