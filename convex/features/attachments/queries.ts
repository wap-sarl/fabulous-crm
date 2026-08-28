import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import {
  type AttachmentEntityType,
  attachmentEntityTypeValidator,
} from '../../_lib/validators/attachments';
import { attachmentMaxBytes, attachmentRetentionDays, fileStore } from '../../lib/fileStorage';
import { attachmentDaysLeft, attachmentPurgeAt } from '../../_lib/validators/attachments';

export type AttachmentRow = Doc<'attachments'> & {
  /** Read URL for preview / download; null when the blob is gone. */
  url: string | null;
  authorName: string | null;
};

async function rowsOf(
  ctx: QueryCtx,
  entityType: AttachmentEntityType,
  entityId: string,
  trashed: boolean,
): Promise<AttachmentRow[]> {
  const rows = await ctx.db
    .query('attachments')
    .withIndex('by_entity', (q) => q.eq('entityType', entityType).eq('entityId', entityId))
    .order('desc')
    .collect();
  const names = new Map<string, string | null>();
  const nameOf = async (id: Doc<'attachments'>['createdBy']) => {
    if (!id) return null;
    if (!names.has(id)) {
      const user = await ctx.db.get(id);
      names.set(id, user ? `${user.firstName} ${user.lastName}` : null);
    }
    return names.get(id) ?? null;
  };
  const out: AttachmentRow[] = [];
  for (const row of rows) {
    if ((row.deletedAt !== undefined) !== trashed) continue;
    out.push({
      ...row,
      url: await fileStore(row.provider).getUrl(ctx, row),
      authorName: await nameOf(row.createdBy),
    });
  }
  return out;
}

/** The live files of a record, newest first; the client derives the folder tree from `folder`. */
export const listAttachments = employeeQuery({
  args: { entityType: attachmentEntityTypeValidator, entityId: v.string() },
  handler: async (ctx, args): Promise<AttachmentRow[]> =>
    rowsOf(ctx, args.entityType, args.entityId, false),
});

export type TrashedAttachmentRow = AttachmentRow & {
  deletedAt: number;
  deletedByName: string | null;
  purgeAt: number;
  daysLeft: number;
};

/** The trash of a record: deleted files with who deleted them and when they get purged. */
export const listDeletedAttachments = employeeQuery({
  args: { entityType: attachmentEntityTypeValidator, entityId: v.string() },
  handler: async (ctx, args): Promise<TrashedAttachmentRow[]> => {
    const retentionDays = await attachmentRetentionDays(ctx);
    const now = Date.now();
    const names = new Map<string, string | null>();
    const out: TrashedAttachmentRow[] = [];
    for (const row of await rowsOf(ctx, args.entityType, args.entityId, true)) {
      const deletedAt = row.deletedAt as number;
      if (row.deletedBy && !names.has(row.deletedBy)) {
        const user = await ctx.db.get(row.deletedBy);
        names.set(row.deletedBy, user ? `${user.firstName} ${user.lastName}` : null);
      }
      const purgeAt = row.purgeAt ?? attachmentPurgeAt(deletedAt, retentionDays);
      out.push({
        ...row,
        deletedAt,
        deletedByName: row.deletedBy ? (names.get(row.deletedBy) ?? null) : null,
        purgeAt,
        daysLeft: attachmentDaysLeft(purgeAt, now),
      });
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt);
  },
});

/** The upload cap and trash retention, for the client-side pre-check and the card's wording. */
export const getAttachmentLimits = employeeQuery({
  args: {},
  handler: async (ctx) => ({
    maxSizeBytes: await attachmentMaxBytes(ctx),
    retentionDays: await attachmentRetentionDays(ctx),
  }),
});
