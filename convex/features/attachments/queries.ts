import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { employeeQuery } from '../../_lib/auth';
import { attachmentEntityTypeValidator } from '../../_lib/validators/attachments';
import { attachmentMaxBytes, fileStore } from '../../lib/fileStorage';

export type AttachmentRow = Doc<'attachments'> & {
  /** Read URL for preview / download; null when the blob is gone. */
  url: string | null;
  authorName: string | null;
};

/** Every file of a record, newest first; the client derives the folder tree from `folder`. */
export const listAttachments = employeeQuery({
  args: { entityType: attachmentEntityTypeValidator, entityId: v.string() },
  handler: async (ctx, args): Promise<AttachmentRow[]> => {
    const rows = await ctx.db
      .query('attachments')
      .withIndex('by_entity', (q) =>
        q.eq('entityType', args.entityType).eq('entityId', args.entityId),
      )
      .order('desc')
      .collect();
    const names = new Map<string, string | null>();
    const out: AttachmentRow[] = [];
    for (const row of rows) {
      if (row.createdBy && !names.has(row.createdBy)) {
        const user = await ctx.db.get(row.createdBy);
        names.set(row.createdBy, user ? `${user.firstName} ${user.lastName}` : null);
      }
      out.push({
        ...row,
        url: await fileStore(row.provider).getUrl(ctx, row),
        authorName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      });
    }
    return out;
  },
});

/** The upload cap, for the client-side pre-check and the settings screen. */
export const getAttachmentLimits = employeeQuery({
  args: {},
  handler: async (ctx) => ({ maxSizeBytes: await attachmentMaxBytes(ctx) }),
});
