import type { LucideIcon } from 'lucide-react';
import { CalendarDays, ListTodo, Mail, Phone, StickyNote } from 'lucide-react';
import type { ActivityType } from '@crm/lib/backend';

export const ACTIVITY_ICON: Record<ActivityType, LucideIcon> = {
  task: ListTodo,
  call: Phone,
  meeting: CalendarDays,
  email: Mail,
  note: StickyNote,
};
