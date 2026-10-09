import type { ReactNode } from 'react';
import type { FrontendExtensions } from '../../src/lib/extensionTypes';

/** Stands in for an overlay when the suite is run with OVERLAY_STAND_IN: every hook defined (the type requires each optional one, so a new hook of the contract must be added here), each answer recognisable. It words every code and hides the code form whatever it is asked, more than an overlay may, so that a test of the core alone fails here unless it says which extensions it runs with; frozen, so that a test writing on the installed extensions fails too, in any order. */
export const overlayStandIn: Required<FrontendExtensions> = Object.freeze<
  Required<FrontendExtensions>
>({
  routes: [
    { path: '/stand-in', element: null },
    { path: '/settings/stand-in', element: null },
  ],
  navItems: [
    { label: 'Stand-in', icon: null, path: '/stand-in' },
    { label: 'Stand-in', icon: null, path: '/settings/stand-in', requires: 'settings' },
  ],
  ShellGuard: ({ children }: { children: ReactNode }) => children,
  describeRefusal: ({ code }) => `stand-in: ${code}`,
  loginMethods: () => ({ emailCode: false, emailCodeNotice: 'stand-in' }),
});
