import {
  Building2,
  ClipboardList,
  Gauge,
  Handshake,
  Hourglass,
  KanbanSquare,
  KeyRound,
  LayoutGrid,
  ListChecks,
  ListTodo,
  Mail,
  Megaphone,
  Milestone,
  Palette,
  Radar,
  Upload,
  Paperclip,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UsersRound,
  Workflow,
} from 'lucide-react';
import type { NavItem } from '@crm/widgets';

/** A sidebar entry; module pages derive their access check from the path, settings pages declare it. */
export interface ShellNavItem extends NavItem {
  requires?: 'settings';
}

const settings = (item: NavItem): ShellNavItem => ({
  ...item,
  position: 'bottom',
  requires: 'settings',
});

export const NAV_ITEMS: ShellNavItem[] = [
  { label: 'Leads', icon: <Users />, path: '/leads' },
  { label: 'Entreprises', icon: <Building2 />, path: '/companies' },
  { label: 'Transactions', icon: <Handshake />, path: '/deals' },
  { label: 'Tâches', icon: <ListTodo />, path: '/tasks' },
  { label: 'Campagnes', icon: <Megaphone />, path: '/campaigns' },
  { label: 'Workflows', icon: <Workflow />, path: '/workflows' },
  ...(import.meta.env.DEV
    ? [
        {
          label: 'Design system',
          icon: <LayoutGrid />,
          path: '/design-system',
          position: 'bottom',
        } satisfies ShellNavItem,
      ]
    : []),
  // Imports are for every employee, on the modules the role may write to.
  { label: 'Importer', icon: <Upload />, path: '/import', position: 'bottom' },
  // Lists are available to every employee; the other settings screens need the role's `settings` switch.
  { label: 'Listes', icon: <ListChecks />, path: '/settings/lists', position: 'bottom' },
  // Connecting one's own account is for every employee; the page shows the OAuth apps to admins only.
  { label: 'Intégrations', icon: <Plug />, path: '/settings/integrations', position: 'bottom' },
  settings({ label: 'Équipe', icon: <UsersRound />, path: '/settings/team' }),
  settings({ label: 'Rôles et accès', icon: <ShieldCheck />, path: '/settings/roles' }),
  settings({ label: 'Apparence', icon: <Palette />, path: '/settings/branding' }),
  settings({ label: 'E-mail & SMS', icon: <Mail />, path: '/settings/email' }),
  settings({ label: 'Propriétés', icon: <SlidersHorizontal />, path: '/settings/properties' }),
  settings({ label: 'Statuts', icon: <Milestone />, path: '/settings/lifecycle' }),
  settings({ label: 'Scoring', icon: <Gauge />, path: '/settings/scoring' }),
  settings({ label: 'Formulaires', icon: <ClipboardList />, path: '/settings/forms' }),
  settings({ label: 'Suivi web', icon: <Radar />, path: '/settings/tracking' }),
  settings({ label: 'Clés d’API', icon: <KeyRound />, path: '/settings/api' }),
  settings({ label: 'Pipelines', icon: <KanbanSquare />, path: '/settings/pipelines' }),
  settings({ label: 'Fichiers', icon: <Paperclip />, path: '/settings/files' }),
  settings({ label: 'Conservation', icon: <Hourglass />, path: '/settings/retention' }),
];
