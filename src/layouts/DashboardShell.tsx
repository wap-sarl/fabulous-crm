import { Suspense, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Spinner } from '@crm/design-system';
import { DashboardLayout, useAuth } from '@crm/widgets';
import type { RoleAccess } from '@crm/lib/backend';
import { canAccessModule, moduleOfPath } from '../features/access/lib/constants';
import { frontendExtensions } from '../lib/frontendExtensions';
import { NAV_ITEMS, type ShellNavItem } from '../lib/navigation';
import { sidebarEntries } from '../lib/settingsTabs';

/** Declarative: a page sets the document title by calling this hook. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `CRM — ${title}` : 'CRM';
    return () => {
      document.title = 'CRM';
    };
  }, [title]);
}

/** Module pages follow the role's access matrix; `requires: 'settings'` follows its settings switch. */
function canSee(item: ShellNavItem, access: RoleAccess | undefined): boolean {
  if (item.requires === 'settings' && !access?.settings) return false;
  const module = moduleOfPath(item.path);
  return !module || canAccessModule(access, module);
}

export function DashboardShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  // Highlight the top-level nav item even on nested/detail routes
  const currentPath = `/${location.pathname.split('/')[1] ?? ''}`;

  // One list for everyone, built-in and overlay items alike; visibility is per item. An overlay's settings entries are tabs of the settings page.
  const navItems = [...NAV_ITEMS, ...sidebarEntries(frontendExtensions().navItems)].filter((item) =>
    canSee(item, user?.access),
  );

  const Guard = frontendExtensions().ShellGuard;
  const shell = (
    <DashboardLayout
      navItems={navItems}
      currentPath={currentPath}
      onNavigate={navigate}
      userName={user?.name}
      userEmail={user?.email}
      onLogout={logout}
    >
      {/* The shell stays while the page of the route is being loaded. */}
      <Suspense
        fallback={
          <div className="flex justify-center py-24">
            <Spinner size="lg" />
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </DashboardLayout>
  );
  return Guard ? <Guard>{shell}</Guard> : shell;
}
