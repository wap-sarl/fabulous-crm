import {
  Users,
  Building2,
  Handshake,
  ListTodo,
  Megaphone,
  Workflow,
  LayoutGrid,
} from 'lucide-react';
import type { NavItem } from '@crm/widgets';

export const NAV_ITEMS: NavItem[] = [
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
        } satisfies NavItem,
      ]
    : []),
];
