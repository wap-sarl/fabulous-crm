import type { ComponentType } from 'react';
import type { PluginKey } from '@crm/lib/backend';
import { page } from '../../../lib/page';

// The one place the frontend names a plugin: its pages, by key. The menu, the tabs and the icons come from the catalogue.

interface PluginRoute {
  path: string;
  Page: ComponentType;
}

const PAGES: Record<PluginKey, PluginRoute[]> = {
  'landing-pages': [
    {
      path: '/pages',
      Page: page(() => import('../../../pages/landingPages/LandingPagesPage'), 'LandingPagesPage'),
    },
    {
      path: '/pages/:pageId',
      Page: page(
        () => import('../../../pages/landingPages/LandingPageEditorPage'),
        'LandingPageEditorPage',
      ),
    },
  ],
  slack: [
    {
      path: '/settings/slack',
      Page: page(() => import('../../../pages/settings/SlackSettingsPage'), 'SlackSettingsPage'),
    },
  ],
  discord: [
    {
      path: '/settings/discord',
      Page: page(
        () => import('../../../pages/settings/DiscordSettingsPage'),
        'DiscordSettingsPage',
      ),
    },
  ],
};

/** The routes of each plugin, in the catalogue's order. */
export const PLUGIN_ROUTES = (Object.keys(PAGES) as PluginKey[]).map((key) => ({
  key,
  routes: PAGES[key],
}));
