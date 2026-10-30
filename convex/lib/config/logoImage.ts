import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

/** A logo stored before its type was recorded (`logoImage`) gets the type from the stored file, which Convex recorded at upload; the proportions stay unknown, so a mail shows it by its height alone. Nothing for a config without a logo, or whose logo is already described. */
export async function recordedLogoImage(
  ctx: Pick<MutationCtx, 'db'>,
  config: Doc<'appConfig'>,
): Promise<Pick<Doc<'appConfig'>, 'logoImage'> | undefined> {
  if (!config.logoStorageId || config.logoImage) return undefined;
  const file = await ctx.db.system.get(config.logoStorageId);
  return file?.contentType ? { logoImage: { contentType: file.contentType } } : undefined;
}
