import { v } from 'convex/values';
import { internalMutation } from '../../_lib/functions';
import { fileStore } from '../../lib/attachments/storage';

/** Scheduled at soft delete for `purgeAt`; a no-op unless the row is still trashed for that very date. */
export const purgeAttachmentAt = internalMutation({
  args: { attachmentId: v.id('attachments'), purgeAt: v.number() },
  returns: v.union(v.literal('skipped'), v.literal('purged')),
  handler: async (ctx, args): Promise<'purged' | 'skipped'> => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.deletedAt === undefined || attachment.purgeAt !== args.purgeAt) {
      return 'skipped';
    }
    await fileStore(attachment.provider).delete(ctx, attachment);
    await ctx.db.delete(attachment._id);
    return 'purged';
  },
});
