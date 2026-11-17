import type { ReactNode } from 'react';
import { MessageCircle, MessagesSquare, PanelsTopLeft } from 'lucide-react';
import type { PluginIcon } from '@crm/lib/backend';

/** The icons a plugin may ask for in the catalogue, drawn. */
export const PLUGIN_ICONS: Record<PluginIcon, ReactNode> = {
  PanelsTopLeft: <PanelsTopLeft className="size-5" aria-hidden="true" />,
  MessagesSquare: <MessagesSquare className="size-5" aria-hidden="true" />,
  MessageCircle: <MessageCircle className="size-5" aria-hidden="true" />,
};

/** The same icons at the size of a menu entry. */
export const PLUGIN_NAV_ICONS: Record<PluginIcon, ReactNode> = {
  PanelsTopLeft: <PanelsTopLeft />,
  MessagesSquare: <MessagesSquare />,
  MessageCircle: <MessageCircle />,
};
