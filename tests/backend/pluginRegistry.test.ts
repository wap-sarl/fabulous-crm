import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PLUGINS, pluginsTagged } from '../../convex/_lib/validators/plugins';
import { NOTIFICATION_CHANNELS } from '../../convex/lib/notifications/channels';
import { PLUGIN_REGISTRY, pluginChannels } from '../../convex/lib/plugins/registry';

const ROOT = join(import.meta.dir, '../..');

/** Where each plugin may be named: the catalogue, the registry, the frontend's page map, and the plugin's own files. */
const ALLOWED: Record<string, string[]> = {
  '*': [
    'convex/_lib/validators/plugins.ts',
    'convex/lib/plugins/registry.ts',
    'src/features/plugins/lib/pages.tsx',
  ],
  'landing-pages': [
    'convex/features/landingPages/',
    'convex/lib/landingPages/',
    'src/pages/landingPages/',
    'src/features/landingPages/',
  ],
  slack: ['convex/lib/notifications/channels/slack.ts', 'src/pages/settings/SlackSettingsPage.tsx'],
  discord: [
    'convex/lib/notifications/channels/discord.ts',
    'src/pages/settings/DiscordSettingsPage.tsx',
  ],
};

function sourcesOf(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourcesOf(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the plugin registry', () => {
  test('has one entry per key of the catalogue, and brings a channel for each plugin tagged as a discussion channel and for no other', () => {
    expect(Object.keys(PLUGIN_REGISTRY).sort()).toEqual(PLUGINS.map((p) => p.key).sort());
    const tagged = pluginsTagged('discussion-channel').map((p) => p.key);
    expect(tagged).toEqual(['slack', 'discord']);
    for (const plugin of PLUGINS) {
      const channel = PLUGIN_REGISTRY[plugin.key].channel;
      expect(channel !== undefined).toBe(tagged.includes(plugin.key));
      if (channel) expect(channel.plugin).toBe(plugin.key);
    }
    expect(pluginChannels().map((c) => c.key)).toEqual(tagged);
    // The notification registry is the core's e-mail, then the plugins' channels in the catalogue's order.
    expect(NOTIFICATION_CHANNELS.map((c) => c.key)).toEqual(['email', ...tagged]);
  });

  test('is the only place the core names a plugin: a plugin is spelled out in the catalogue, the registry, the page map and its own files', () => {
    const keys = PLUGINS.map((p) => p.key);
    const offenders: string[] = [];
    for (const file of [...sourcesOf('convex'), ...sourcesOf('src')]) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const key of keys) {
        if (!new RegExp(`(['"\`])${key}\\1|="${key}"`).test(source)) continue;
        const allowed = [...ALLOWED['*']!, ...(ALLOWED[key] ?? [])];
        if (!allowed.some((place) => file === place || file.startsWith(place))) {
          offenders.push(`${relative(ROOT, join(ROOT, file))} names ${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
