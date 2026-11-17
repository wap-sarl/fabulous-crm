import { type LucideIcon, MessageCircle, MessagesSquare, PanelsTopLeft } from 'lucide-react';
import type { PluginIcon } from '@crm/lib/backend';

/** The icons a plugin may ask for in the catalogue: the component, sized by whoever draws it. */
export const PLUGIN_ICONS: Record<PluginIcon, LucideIcon> = {
  PanelsTopLeft,
  MessagesSquare,
  MessageCircle,
};
