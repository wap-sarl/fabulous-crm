import type { LucideIcon } from 'lucide-react';
import { Handshake, ListTodo, Megaphone, Upload, Users, UsersRound } from 'lucide-react';
import type { StatusTone } from '@crm/design-system';
import {
  type NotificationGroup,
  type NotificationKind,
  notificationGroupOf,
} from '@crm/lib/backend';

/** The icon and the tone of a group, the same as the sidebar's entry for the module. */
const GROUP_PRESENTATION: Record<NotificationGroup, { icon: LucideIcon; tone: StatusTone }> = {
  leads: { icon: Users, tone: 'blue' },
  deals: { icon: Handshake, tone: 'green' },
  activities: { icon: ListTodo, tone: 'amber' },
  campaigns: { icon: Megaphone, tone: 'violet' },
  imports: { icon: Upload, tone: 'gray' },
  team: { icon: UsersRound, tone: 'gray' },
};

export const presentationOf = (kind: NotificationKind) =>
  GROUP_PRESENTATION[notificationGroupOf(kind)];
