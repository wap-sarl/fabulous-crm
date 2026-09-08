import type { ComponentType, ReactNode } from 'react';
import type { ShellNavItem } from './navigation';

export interface ExtensionRoute {
  /** Absolute path mounted inside the authenticated shell, e.g. `/settings/billing`. */
  path: string;
  element: ReactNode;
}

/** What a deployment overlay may add to the SPA (see docs/extensions.md). */
export interface FrontendExtensions {
  routes: ExtensionRoute[];
  /** Same visibility rules as the built-in items: `requires: 'settings'` hides it from non-admins. */
  navItems: ShellNavItem[];
  /** Wraps the whole authenticated shell; may render something else instead of its children. */
  ShellGuard: ComponentType<{ children: ReactNode }> | null;
}
