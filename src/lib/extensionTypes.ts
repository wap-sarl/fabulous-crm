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
  /** A user message for one of the overlay's refusal codes (`describeError`), null for the rest. */
  describeRefusal?: (refusal: Refusal) => string | null;
  /** The login page asks before showing the e-mail code form; `config` is the public config, the overlay's own fields included. */
  loginMethods?: (config: Record<string, unknown>, search: URLSearchParams) => LoginMethods | null;
}

/** What an overlay may decide about the login page; an absent field keeps the page's own rule. */
export interface LoginMethods {
  /** `false` hides the e-mail code form; the providers (social, SSO) stay. */
  emailCode?: boolean;
  /** A sentence shown with the e-mail code form, e.g. who may use it: a refused code request is silent, this is where to say so. */
  emailCodeNotice?: string;
}

/** A refusal as the client sees it: the code, and the structured data of a ConvexError when there is one. */
export interface Refusal {
  code: string;
  data: Record<string, unknown>;
}
