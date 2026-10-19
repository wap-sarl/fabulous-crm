import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import { isPluginKey, type PluginKey } from '../../_lib/validators/plugins';
import { loadAppConfig } from '../config/load';

/** The installed plugins a config names, those of the catalogue only: a key the catalogue dropped is ignored, not an error. */
export const installedPlugins = (
  cfg: Pick<Doc<'appConfig'>, 'plugins'> | null | undefined,
): PluginKey[] => (cfg?.plugins ?? []).filter(isPluginKey);

export async function loadInstalledPlugins(ctx: Pick<QueryCtx, 'db'>): Promise<PluginKey[]> {
  return installedPlugins(await loadAppConfig(ctx));
}

export async function isPluginInstalled(
  ctx: Pick<QueryCtx, 'db'>,
  key: PluginKey,
): Promise<boolean> {
  return (await loadInstalledPlugins(ctx)).includes(key);
}

/** A function of a plugin refuses while the plugin is not installed: its data stays, nothing reads or writes it. */
export async function requirePlugin(ctx: Pick<QueryCtx, 'db'>, key: PluginKey): Promise<void> {
  if (!(await isPluginInstalled(ctx, key))) {
    throw refusal('plugin_not_installed', {
      plugin: key,
      message: 'Ce plugin n’est pas installé.',
    });
  }
}

/** The plugins a deployment upgraded from before the catalogue was already using: those whose data exists. */
export async function pluginsInUse(
  ctx: Pick<QueryCtx, 'db'>,
  cfg: Pick<Doc<'appConfig'>, 'plugins'>,
): Promise<PluginKey[]> {
  const installed = installedPlugins(cfg);
  const missing: PluginKey[] = [];
  if (!installed.includes('landing-pages') && (await ctx.db.query('landingPages').first())) {
    missing.push('landing-pages');
  }
  return missing;
}
