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
  PanelsTopLeft,
  Radar,
  Settings,
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
import { SETTINGS_ROOT, type TabGroup } from './settingsTabs';

/** A sidebar entry; module pages derive their access check from the path, settings pages declare it. */
export interface ShellNavItem extends NavItem {
  requires?: 'settings';
  /** The group of the settings page an entry under /settings/ is shown in; an overlay names its own, or takes the default. */
  group?: string;
}

const settings = (item: NavItem): ShellNavItem => ({ ...item, requires: 'settings' });

export const NAV_ITEMS: ShellNavItem[] = [
  { label: 'Leads', icon: <Users />, path: '/leads' },
  { label: 'Entreprises', icon: <Building2 />, path: '/companies' },
  { label: 'Transactions', icon: <Handshake />, path: '/deals' },
  { label: 'Tâches', icon: <ListTodo />, path: '/tasks' },
  { label: 'Campagnes', icon: <Megaphone />, path: '/campaigns' },
  { label: 'Pages', icon: <PanelsTopLeft />, path: '/pages' },
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
  // One entry for every setting: the page shows the tabs the role may see, and two of them are for every employee.
  { label: 'Paramètres', icon: <Settings />, path: SETTINGS_ROOT, position: 'bottom' },
];

/** The tabs of the settings page, in the order they are shown; each keeps the address it had as a sidebar entry. */
export const SETTINGS_GROUPS: TabGroup<ShellNavItem>[] = [
  {
    name: 'Organisation',
    tabs: [
      settings({ label: 'Apparence', icon: <Palette />, path: '/settings/branding' }),
      settings({ label: 'Équipe', icon: <UsersRound />, path: '/settings/team' }),
      settings({ label: 'Rôles et accès', icon: <ShieldCheck />, path: '/settings/roles' }),
    ],
  },
  {
    name: 'Données',
    tabs: [
      settings({ label: 'Propriétés', icon: <SlidersHorizontal />, path: '/settings/properties' }),
      settings({ label: 'Statuts', icon: <Milestone />, path: '/settings/lifecycle' }),
      settings({ label: 'Pipelines', icon: <KanbanSquare />, path: '/settings/pipelines' }),
      settings({ label: 'Scoring', icon: <Gauge />, path: '/settings/scoring' }),
      // Lists are available to every employee.
      { label: 'Listes', icon: <ListChecks />, path: '/settings/lists' },
    ],
  },
  {
    name: 'Canaux',
    tabs: [
      settings({ label: 'E-mail & SMS', icon: <Mail />, path: '/settings/email' }),
      settings({ label: 'Formulaires', icon: <ClipboardList />, path: '/settings/forms' }),
      settings({ label: 'Suivi web', icon: <Radar />, path: '/settings/tracking' }),
    ],
  },
  {
    name: 'Connexions et conformité',
    tabs: [
      // Connecting one's own account is for every employee; the page shows the OAuth apps to admins only.
      { label: 'Intégrations', icon: <Plug />, path: '/settings/integrations' },
      settings({ label: 'Clés d’API', icon: <KeyRound />, path: '/settings/api' }),
      settings({ label: 'Fichiers', icon: <Paperclip />, path: '/settings/files' }),
      settings({ label: 'Conservation', icon: <Hourglass />, path: '/settings/retention' }),
    ],
  },
];
