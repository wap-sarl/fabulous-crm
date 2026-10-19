import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { settingsMutation } from '../../_lib/auth';
import { refusal } from '../../_lib/refusal';
import { pluginKeySchema } from '../../_lib/validators/plugins';
import { logAudit } from '../../lib/audit/log';
import { loadAppConfig } from '../../lib/config/load';
import { installedPlugins } from '../../lib/plugins/installed';

const installedValidator = v.object({ installed: v.array(v.string()) });

/** The one write: a plugin joins or leaves the installed list, audited; asking for the state it is in changes nothing. */
async function setInstalled(
  ctx: MutationCtx & { userId: Id<'users'> },
  key: string,
  installed: boolean,
) {
  const parsed = pluginKeySchema.safeParse(key);
  if (!parsed.success) throw refusal('plugin_unknown', { reason: key });
  const cfg = await loadAppConfig(ctx);
  if (!cfg) throw new Error('Config not initialized');
  const current = installedPlugins(cfg);
  if (current.includes(parsed.data) === installed) return { installed: current };
  const next = installed
    ? [...current, parsed.data]
    : current.filter((plugin) => plugin !== parsed.data);
  await ctx.db.patch(cfg._id, { plugins: next, updatedAt: Date.now(), updatedBy: ctx.userId });
  await logAudit({
    ctx,
    userId: ctx.userId,
    entityType: 'plugin',
    entityId: parsed.data,
    action: 'update',
    metadata: { installed },
  });
  return { installed: next };
}

/** The plugin's functions, pages and public routes open; its data, kept through an uninstall, is back as it was. */
export const installPlugin = settingsMutation({
  args: { key: v.string() },
  returns: installedValidator,
  handler: async (ctx, args) => await setInstalled(ctx, args.key, true),
});

/** The plugin's functions refuse, its entries disappear and its public routes answer 404; its data stays. */
export const uninstallPlugin = settingsMutation({
  args: { key: v.string() },
  returns: installedValidator,
  handler: async (ctx, args) => await setInstalled(ctx, args.key, false),
});
