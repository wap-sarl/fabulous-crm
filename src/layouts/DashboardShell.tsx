import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  UsersRound,
  Palette,
  SlidersHorizontal,
  ListChecks,
  Mail,
  Milestone,
  KanbanSquare,
} from 'lucide-react';
import { DashboardLayout, useAuth, type NavItem } from '@crm/widgets';
import { NAV_ITEMS } from '../lib/navigation';

const TEAM_NAV_ITEM: NavItem = {
  label: 'Équipe',
  icon: <UsersRound />,
  path: '/settings/team',
  position: 'bottom',
};

const BRANDING_NAV_ITEM: NavItem = {
  label: 'Apparence',
  icon: <Palette />,
  path: '/settings/branding',
  position: 'bottom',
};

const PROPERTIES_NAV_ITEM: NavItem = {
  label: 'Propriétés',
  icon: <SlidersHorizontal />,
  path: '/settings/lead-properties',
  position: 'bottom',
};

const LIFECYCLE_NAV_ITEM: NavItem = {
  label: 'Statut du lead',
  icon: <Milestone />,
  path: '/settings/lifecycle',
  position: 'bottom',
};

const PIPELINES_NAV_ITEM: NavItem = {
  label: 'Pipelines',
  icon: <KanbanSquare />,
  path: '/settings/pipelines',
  position: 'bottom',
};

const EMAIL_NAV_ITEM: NavItem = {
  label: 'E-mail & SMS',
  icon: <Mail />,
  path: '/settings/email',
  position: 'bottom',
};

// Lists are available to every employee (not admin-gated).
const LISTS_NAV_ITEM: NavItem = {
  label: 'Listes',
  icon: <ListChecks />,
  path: '/settings/lists',
  position: 'bottom',
};

/** Declarative: a page sets the document title by calling this hook. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `CRM — ${title}` : 'CRM';
    return () => {
      document.title = 'CRM';
    };
  }, [title]);
}

export function DashboardShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  // Highlight the top-level nav item even on nested/detail routes
  const currentPath = `/${location.pathname.split('/')[1] ?? ''}`;

  // Lists are for everyone; team + branding + custom-property management are admin-only.
  const navItems =
    user?.role === 'admin'
      ? [
          ...NAV_ITEMS,
          LISTS_NAV_ITEM,
          TEAM_NAV_ITEM,
          BRANDING_NAV_ITEM,
          EMAIL_NAV_ITEM,
          PROPERTIES_NAV_ITEM,
          LIFECYCLE_NAV_ITEM,
          PIPELINES_NAV_ITEM,
        ]
      : [...NAV_ITEMS, LISTS_NAV_ITEM];

  return (
    <DashboardLayout
      navItems={navItems}
      currentPath={currentPath}
      onNavigate={navigate}
      userName={user?.name}
      userEmail={user?.email}
      onLogout={logout}
    >
      <Outlet />
    </DashboardLayout>
  );
}
