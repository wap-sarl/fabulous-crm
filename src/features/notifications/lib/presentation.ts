import type { LucideIcon } from 'lucide-react';
import { Handshake, ListTodo, Megaphone, Upload, Users, UsersRound } from 'lucide-react';
import type { StatusTone } from '@crm/design-system';
import {
  type NotificationGroup,
  type NotificationKind,
  notificationGroupOf,
} from '@crm/lib/backend';

/** The icon and the tone of a group, the same as the sidebar's entry for the module, and its name on the settings page. */
const GROUP_PRESENTATION: Record<
  NotificationGroup,
  { icon: LucideIcon; tone: StatusTone; label: string }
> = {
  leads: { icon: Users, tone: 'blue', label: 'Leads' },
  deals: { icon: Handshake, tone: 'green', label: 'Transactions' },
  activities: { icon: ListTodo, tone: 'amber', label: 'Tâches' },
  campaigns: { icon: Megaphone, tone: 'violet', label: 'Campagnes et workflows' },
  imports: { icon: Upload, tone: 'gray', label: 'Imports' },
  team: { icon: UsersRound, tone: 'gray', label: 'Équipe' },
};

export const groupPresentationOf = (group: NotificationGroup) => GROUP_PRESENTATION[group];

export const presentationOf = (kind: NotificationKind) =>
  GROUP_PRESENTATION[notificationGroupOf(kind)];
