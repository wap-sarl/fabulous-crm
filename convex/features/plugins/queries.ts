import { v } from 'convex/values';
import type { QueryCtx } from '../../_generated/server';
import { settingsQuery } from '../../_lib/auth';
import { PLUGINS, type PluginKey } from '../../_lib/validators/plugins';
import { loadInstalledPlugins } from '../../lib/plugins/installed';

const PUBLIC_URLS_SHOWN = 10;

/** The public addresses of a plugin that stop answering at its uninstall, the first ten and whether there are more: what the confirmation names. */
async function publicUrlsOf(
  ctx: Pick<QueryCtx, 'db'>,
  key: PluginKey,
): Promise<{ publicUrls: string[]; morePublicUrls: boolean }> {
  if (key !== 'landing-pages') return { publicUrls: [], morePublicUrls: false };
  const pages = await ctx.db
    .query('landingPages')
    .withIndex('by_deletedAt', (q) => q.eq('deletedAt', undefined))
    .filter((q) => q.eq(q.field('status'), 'published'))
    .take(PUBLIC_URLS_SHOWN + 1);
  const base = process.env.CONVEX_SITE_URL ?? '';
  return {
    publicUrls: pages.slice(0, PUBLIC_URLS_SHOWN).map((page) => `${base}/p/${page.slug}`),
    morePublicUrls: pages.length > PUBLIC_URLS_SHOWN,
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
      installed: v.boolean(),
      publicUrls: v.array(v.string()),
      morePublicUrls: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const installed = await loadInstalledPlugins(ctx);
    const rows = [];
    for (const plugin of PLUGINS) {
      const isInstalled = installed.includes(plugin.key);
      rows.push({
        ...plugin,
        installed: isInstalled,
        ...(isInstalled
          ? await publicUrlsOf(ctx, plugin.key)
          : { publicUrls: [], morePublicUrls: false }),
      });
    }
    return rows;
  },
});
