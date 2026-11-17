import type { QueryCtx } from '../../_generated/server';
import { type PluginKey, PLUGINS, pluginsTagged } from '../../_lib/validators/plugins';
import { landingPagesHaveData, publishedPageUrls } from '../landingPages/plugin';
import { discordChannel } from '../notifications/channels/discord';
import type { NotificationChannel } from '../notifications/channels/index';
import { slackChannel } from '../notifications/channels/slack';

// What the server brings for each plugin of the catalogue, under its key: the core reads this, by tag, and never names a plugin.

/** What a plugin contributes beyond its own functions and pages. */
export interface PluginContribution {
  /** The channel of a plugin tagged `discussion-channel`: on the notifications page while the plugin is installed. */
  channel?: NotificationChannel;
  /** Whether live data of the plugin exists: a deployment from before the catalogue keeps the plugins whose data it holds. */
  hasData?: (ctx: Pick<QueryCtx, 'db'>) => Promise<boolean>;
  /** The public addresses an uninstall closes, up to `limit` and one more when there are more: what the confirmation names. */
  publicUrls?: (ctx: Pick<QueryCtx, 'db'>, limit: number) => Promise<string[]>;
}

/** One entry per key of the catalogue: a key without one does not compile. */
export const PLUGIN_REGISTRY: Record<PluginKey, PluginContribution> = {
  'landing-pages': { hasData: landingPagesHaveData, publicUrls: publishedPageUrls },
  slack: { channel: slackChannel },
  discord: { channel: discordChannel },
};

export const pluginContribution = (key: PluginKey): PluginContribution => PLUGIN_REGISTRY[key];

/** The channels the plugins bring, in the catalogue's order: those of the plugins tagged as a discussion channel. A tagged plugin without a channel is a mistake of the registry, said at load. */
export function pluginChannels(): NotificationChannel[] {
  return pluginsTagged('discussion-channel').map((plugin) => {
    const channel = PLUGIN_REGISTRY[plugin.key as PluginKey].channel;
    if (!channel)
      throw new Error(`plugin ${plugin.key} is tagged discussion-channel but brings no channel`);
    return channel;
  });
}

/** The keys of the catalogue, for a walk over every plugin. */
export const pluginKeys = (): PluginKey[] => PLUGINS.map((plugin) => plugin.key);
