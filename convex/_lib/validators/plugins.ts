import { z } from 'zod';

/** The optional features of this repository a deployment installs from Paramètres → Plugins; the closed catalogue, nothing is downloaded. */
export const PLUGINS = [
  {
    key: 'landing-pages',
    name: 'Pages',
    description:
      'Des pages hébergées par le CRM, composées de blocs avec vos formulaires, publiées sous /p/<adresse>, avec leurs vues, leurs envois et un test A/B.',
  },
] as const;

export type PluginKey = (typeof PLUGINS)[number]['key'];

const PLUGIN_KEYS = PLUGINS.map((plugin) => plugin.key) as [PluginKey, ...PluginKey[]];

export const pluginKeySchema = z.enum(PLUGIN_KEYS);

export const isPluginKey = (key: string): key is PluginKey =>
  pluginKeySchema.safeParse(key).success;
