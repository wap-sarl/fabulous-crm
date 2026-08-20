import { Users, Megaphone, Workflow, LayoutGrid } from 'lucide-react';
import type { NavItem } from '@crm/widgets';

export const NAV_ITEMS: NavItem[] = [
  { label: 'Leads', icon: <Users />, path: '/leads' },
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
