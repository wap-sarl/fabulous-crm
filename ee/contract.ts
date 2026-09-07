// Shared by the paid modules and the community-edition stubs; the only coupling between `convex/`, `src/` and `ee/`.

/** Feature keys a signed entitlements token may grant. */
export const EE_FEATURES = ['webhooks', 'managed_oauth', 'enforce_sso'] as const;
export type EeFeature = (typeof EE_FEATURES)[number];

/** Error code thrown by community-edition stubs in place of every paid entry point. */
export const EDITION_REQUIRED = 'edition_required';

export interface EeFrontend {
  readonly bundled: boolean;
  readonly features: readonly EeFeature[];
}

export interface EeBackend {
  readonly bundled: boolean;
  readonly features: readonly EeFeature[];
}
