import { extensions as installed } from '../extensions';
import type { FrontendExtensions } from './extensionTypes';

/** The SPA with no overlay: nothing added, nothing guarded, no optional hook. */
export const defaultFrontendExtensions: FrontendExtensions = {
  routes: [],
  navItems: [],
  ShellGuard: null,
};

let forTests: FrontendExtensions | null = null;

/** What the SPA runs with: `src/extensions.tsx`, the overlay's when there is one. The core reads its extensions here, never from that file, so that a test can say which ones it runs with. Read when called, never when this module loads: an overlay's extensions import the core, which imports this, and nothing of that file exists yet in the middle of such a cycle. */
export const frontendExtensions = (): FrontendExtensions => forTests ?? installed;

/** Test seam, as `setExtensionsForTests` is for the backend hooks: the defaults plus `overrides`, so `{}` is the core alone; `null` puts back what is installed. */
export function setFrontendExtensionsForTests(overrides: Partial<FrontendExtensions> | null): void {
  forTests = overrides ? { ...defaultFrontendExtensions, ...overrides } : null;
}
