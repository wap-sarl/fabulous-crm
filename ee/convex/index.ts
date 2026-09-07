import { EDITION_REQUIRED, type EeBackend, type EeFeature } from '../../ee/contract';

// Paid build: copied over convex/ee/index.ts by `bun run ee:enable`. No paid module exists yet.
export const eeBackend: EeBackend = { bundled: true, features: [] };

export function requireEeModule(feature: EeFeature): never {
  throw new Error(`${EDITION_REQUIRED}: ${feature}`);
}
