import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import { isPluginKey, type PluginKey } from '../../_lib/validators/plugins';
import { loadAppConfig } from '../config/load';

type PluginsField = Pick<Doc<'appConfig'>, 'plugins'> | null | undefined;

/** The keys of the catalogue a config names: a key the catalogue dropped is ignored, not an error. */
const namedPlugins = (cfg: PluginsField): PluginKey[] => (cfg?.plugins ?? []).filter(isPluginKey);

/** The plugins whose data a deployment holds, live rows only: what a deployment from before the catalogue was using. */
export async function pluginsWithData(ctx: Pick<QueryCtx, 'db'>): Promise<PluginKey[]> {
  const page = await ctx.db
    .query('landingPages')
    .withIndex('by_deletedAt', (q) => q.eq('deletedAt', undefined))
    .first();
  return page ? ['landing-pages'] : [];
}

/** The installed plugins: those the config names; a config without the field is from before the catalogue (the wizard writes an empty list), and counts the plugins whose data exists, so an upgrade takes nothing offline. */
export async function resolveInstalledPlugins(
  ctx: Pick<QueryCtx, 'db'>,
  cfg: PluginsField,
): Promise<PluginKey[]> {
  return cfg?.plugins === undefined ? await pluginsWithData(ctx) : namedPlugins(cfg);
}

export async function loadInstalledPlugins(ctx: Pick<QueryCtx, 'db'>): Promise<PluginKey[]> {
  return await resolveInstalledPlugins(ctx, await loadAppConfig(ctx));
}

export async function isPluginInstalled(
  ctx: Pick<QueryCtx, 'db'>,
  key: PluginKey,
): Promise<boolean> {
  return (await loadInstalledPlugins(ctx)).includes(key);
}

const notInstalled = (key: PluginKey) =>
  refusal('plugin_not_installed', { plugin: key, message: 'Ce plugin n’est pas installé.' });

/** A query of a plugin refuses while the plugin is not installed: its data stays, nothing reads it. */
export async function requirePlugin(ctx: Pick<QueryCtx, 'db'>, key: PluginKey): Promise<void> {
  if (!(await isPluginInstalled(ctx, key))) throw notInstalled(key);
}

/** The same for a mutation, which first writes the resolved list down on a config from before the plugins (that field alone: written, not decided), so that deleting a plugin's last data never reads as an uninstall. */
export async function requirePluginForWrite(
  ctx: Pick<MutationCtx, 'db'>,
  key: PluginKey,
): Promise<void> {
  const cfg = await loadAppConfig(ctx);
  const installed = await resolveInstalledPlugins(ctx, cfg);
  if (cfg && cfg.plugins === undefined) await ctx.db.patch(cfg._id, { plugins: installed });
  if (!installed.includes(key)) throw notInstalled(key);
}
