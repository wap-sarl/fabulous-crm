import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

/** The images of a campaign, claimed in its own transaction so the purge leaves them; the caller's own uploads only (the reader is scoped), never a refused one, never one another campaign holds. */
export async function claimEmailImages(
  ctx: MutationCtx,
  campaignId: Id<'campaigns'>,
  imageIds: Id<'emailImages'>[],
): Promise<void> {
  for (const imageId of imageIds) {
    const image = await ctx.db.get(imageId);
    if (image && !image.refused && image.campaignId === undefined) {
      await ctx.db.patch(imageId, { campaignId });
    }
  }
}
