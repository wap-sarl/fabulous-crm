import { z } from 'zod';

/** What kind of thing a plugin is: the core browses the catalogue by tag, never by name. */
export type PluginTag = 'discussion-channel' | 'public-pages';

/** The icons a plugin may ask for, by the name lucide gives them; the frontend keeps the drawing. */
export type PluginIcon = 'PanelsTopLeft' | 'MessagesSquare' | 'MessageCircle';

/** An entry of the menu or a tab of the settings page that a plugin brings; the frontend maps the path to the page. */
interface PluginPlacement {
  label: string;
  path: string;
  icon: PluginIcon;
}

/** One plugin of the catalogue: what both sides may know of it. What the server brings for it is in `lib/plugins/registry.ts`, under the same key. */
export interface PluginEntry {
  key: string;
  name: string;
  description: string;
  tags: readonly PluginTag[];
  /** The sidebar entry of the plugin, for every employee. */
  nav?: PluginPlacement;
  /** The settings tab of the plugin, for the settings right, in the group it names. */
  settings?: PluginPlacement & { group: string };
}

/** The optional features of this repository a deployment installs from Paramètres → Plugins; the closed catalogue, nothing is downloaded. */
export const PLUGINS = [
  {
    key: 'landing-pages',
    name: 'Pages',
    description:
      'Des pages hébergées par le CRM, composées de blocs avec vos formulaires, publiées sous /p/<adresse>, avec leurs vues, leurs envois et un test A/B.',
    tags: ['public-pages'],
    nav: { label: 'Pages', path: '/pages', icon: 'PanelsTopLeft' },
  },
  {
    key: 'slack',
    name: 'Slack',
    description:
      'Les notifications du CRM dans Slack : chaque personne colle le webhook entrant de son espace et reçoit là aussi ce dont elle a choisi d’être informée.',
    tags: ['discussion-channel'],
    settings: { group: 'Canaux', label: 'Slack', path: '/settings/slack', icon: 'MessagesSquare' },
  },
  {
    key: 'discord',
    name: 'Discord',
    description:
      'Les notifications du CRM dans Discord : chaque personne colle le webhook d’un salon privé de son serveur et reçoit là aussi ce dont elle a choisi d’être informée.',
    tags: ['discussion-channel'],
    settings: {
      group: 'Canaux',
      label: 'Discord',
      path: '/settings/discord',
      icon: 'MessageCircle',
    },
  },
] as const satisfies readonly PluginEntry[];

export type PluginKey = (typeof PLUGINS)[number]['key'];

const PLUGIN_KEYS = PLUGINS.map((plugin) => plugin.key) as [PluginKey, ...PluginKey[]];

export const pluginKeySchema = z.enum(PLUGIN_KEYS);

export const isPluginKey = (key: string): key is PluginKey =>
  pluginKeySchema.safeParse(key).success;

/** The plugins of the catalogue that are a kind of thing. */
export const pluginsTagged = (tag: PluginTag): readonly PluginEntry[] =>
  PLUGINS.filter((plugin) => (plugin.tags as readonly PluginTag[]).includes(tag));
