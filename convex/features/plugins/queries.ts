import { v } from 'convex/values';
import { settingsQuery } from '../../_lib/auth';
import { PLUGINS } from '../../_lib/validators/plugins';
import { loadInstalledPlugins } from '../../lib/plugins/installed';

/** The catalogue as the Plugins page shows it: every plugin with whether this deployment installed it. */
export const listPlugins = settingsQuery({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      name: v.string(),
      description: v.string(),
      installed: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const installed = await loadInstalledPlugins(ctx);
    return PLUGINS.map((plugin) => ({ ...plugin, installed: installed.includes(plugin.key) }));
  },
});
