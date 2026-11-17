import { v } from 'convex/values';
import type { QueryCtx } from '../../_generated/server';
import { settingsQuery } from '../../_lib/auth';
import { PLUGINS, type PluginKey } from '../../_lib/validators/plugins';
import { loadInstalledPlugins } from '../../lib/plugins/installed';
import { pluginContribution } from '../../lib/plugins/registry';

const PUBLIC_URLS_SHOWN = 10;

/** The public addresses of a plugin that stop answering at its uninstall, the first ten and whether there are more: what the confirmation names. */
async function publicUrlsOf(
  ctx: Pick<QueryCtx, 'db'>,
  key: PluginKey,
): Promise<{ publicUrls: string[]; morePublicUrls: boolean }> {
  const urls = (await pluginContribution(key).publicUrls?.(ctx, PUBLIC_URLS_SHOWN)) ?? [];
  return {
    publicUrls: urls.slice(0, PUBLIC_URLS_SHOWN),
    morePublicUrls: urls.length > PUBLIC_URLS_SHOWN,
  };
}

/** The catalogue as the Plugins page shows it: every plugin with whether this deployment installed it and, for an installed one, the public addresses an uninstall would close. */
export const listPlugins = settingsQuery({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      name: v.string(),
      description: v.string(),
      tags: v.array(v.string()),
      icon: v.optional(v.string()),
      installed: v.boolean(),
      publicUrls: v.array(v.string()),
      morePublicUrls: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const installed = await loadInstalledPlugins(ctx);
    const rows = [];
    for (const plugin of PLUGINS) {
      const { key } = plugin;
      const isInstalled = installed.includes(key);
      rows.push({
        key,
        name: plugin.name,
        description: plugin.description,
        tags: [...plugin.tags],
        icon: (plugin.nav ?? plugin.settings)?.icon,
        installed: isInstalled,
        ...(isInstalled ? await publicUrlsOf(ctx, key) : { publicUrls: [], morePublicUrls: false }),
      });
    }
    return rows;
  },
});
