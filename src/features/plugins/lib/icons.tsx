import type { ReactNode } from 'react';
import { MessagesSquare, PanelsTopLeft } from 'lucide-react';
import type { PluginKey } from '@crm/lib/backend';

/** The icon of each plugin of the catalogue, as the sidebar shows its entry. */
export const PLUGIN_ICONS: Record<PluginKey, ReactNode> = {
  'landing-pages': <PanelsTopLeft className="size-5" aria-hidden="true" />,
  slack: <MessagesSquare className="size-5" aria-hidden="true" />,
};
