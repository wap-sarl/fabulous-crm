import { docOf } from '../../lib/shared/docs';
import { storageProviderValidator } from '../../_lib/validators/attachments';
import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import {
  type AttachmentEntityType,
  attachmentEntityTypeValidator,
} from '../../_lib/validators/attachments';
import {
  attachmentMaxBytes,
  attachmentRetentionDays,
  fileStore,
} from '../../lib/attachments/storage';
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
  returns: v.array(
    v.object({
      ...docOf('attachments').fields,
      url: v.union(v.string(), v.null()),
      authorName: v.union(v.string(), v.null()),
    }),
  ),
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
  returns: v.array(
    v.object({
      _id: v.id('attachments'),
      _creationTime: v.number(),
      createdBy: v.optional(v.id('users')),
      updatedBy: v.optional(v.id('users')),
      deletedAt: v.number(),
      deletedBy: v.optional(v.id('users')),
      purgeAt: v.number(),
      storageId: v.optional(v.id('_storage')),
      updatedAt: v.number(),
      entityType: attachmentEntityTypeValidator,
      entityId: v.string(),
      name: v.string(),
      folder: v.string(),
      mimeType: v.string(),
      size: v.number(),
      provider: storageProviderValidator,
      key: v.string(),
      url: v.union(v.string(), v.null()),
      authorName: v.union(v.string(), v.null()),
      deletedByName: v.union(v.string(), v.null()),
      daysLeft: v.number(),
    }),
  ),
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
  returns: v.object({ maxSizeBytes: v.number(), retentionDays: v.number() }),
  handler: async (ctx) => ({
    maxSizeBytes: await attachmentMaxBytes(ctx),
    retentionDays: await attachmentRetentionDays(ctx),
  }),
});
