import { z } from 'zod';

/** What installing a plugin adds to a part of the core, beyond its own pages: the Plugins page says it. */
export type PluginProvision = 'notification-channel';

interface PluginEntry {
  key: string;
  name: string;
  description: string;
  provides: readonly PluginProvision[];
}

/** The optional features of this repository a deployment installs from Paramètres → Plugins; the closed catalogue, nothing is downloaded. */
export const PLUGINS = [
  {
    key: 'landing-pages',
    name: 'Pages',
    description:
      'Des pages hébergées par le CRM, composées de blocs avec vos formulaires, publiées sous /p/<adresse>, avec leurs vues, leurs envois et un test A/B.',
    provides: [],
  },
  {
    key: 'slack',
    name: 'Slack',
    description:
      'Les notifications du CRM dans Slack : chaque personne colle le webhook entrant de son espace et reçoit là aussi ce dont elle a choisi d’être informée.',
    provides: ['notification-channel'],
  },
] as const satisfies readonly PluginEntry[];

export type PluginKey = (typeof PLUGINS)[number]['key'];

const PLUGIN_KEYS = PLUGINS.map((plugin) => plugin.key) as [PluginKey, ...PluginKey[]];

export const pluginKeySchema = z.enum(PLUGIN_KEYS);

export const isPluginKey = (key: string): key is PluginKey =>
  pluginKeySchema.safeParse(key).success;
