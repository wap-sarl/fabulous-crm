import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { employeeMutation } from '../../_lib/auth';
import {
  type AttachmentEntityType,
  attachmentEntityTypeValidator,
} from '../../_lib/validators/attachments';
import { createAuditFields, isNotDeleted, logAudit, updateAuditFields } from '../../lib';
import {
  attachmentKey,
  attachmentMaxBytes,
  attachmentRetentionDays,
  fileStore,
  normalizeFileName,
  normalizeFolder,
} from '../../lib/fileStorage';
import { attachmentPurgeAt } from '../../_lib/validators/attachments';
import { internal } from '../../_generated/api';

/** The live record a file is attached to; throws `<entity>_not_found`. */
async function requireEntity(
  ctx: MutationCtx,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<void> {
  const table = entityType === 'lead' ? 'leads' : entityType === 'company' ? 'companies' : 'deals';
  const id = ctx.db.normalizeId(table, entityId);
  const doc = id ? await ctx.db.get(id) : null;
  if (!doc || !isNotDeleted(doc)) throw new Error(`${entityType}_not_found`);
}

function assertSize(size: number, max: number): void {
  if (!Number.isFinite(size) || size < 0) throw new Error('invalid_file_size');
  if (size > max) throw new Error(`attachment_too_large:${max}`);
}

/** A live (not trashed) attachment, or throw. */
async function requireAttachment(ctx: MutationCtx, id: Doc<'attachments'>['_id']) {
  const attachment = await ctx.db.get(id);
  if (!attachment || attachment.deletedAt !== undefined) throw new Error('attachment_not_found');
  return attachment;
}

/** A trashed attachment, or throw (`attachment_not_found` once purged, `attachment_not_deleted` if live). */
async function requireTrashed(ctx: MutationCtx, id: Doc<'attachments'>['_id']) {
  const attachment = await ctx.db.get(id);
  if (!attachment) throw new Error('attachment_not_found');
  if (attachment.deletedAt === undefined) throw new Error('attachment_not_deleted');
  return attachment;
}

const auditMeta = (attachment: Doc<'attachments'>) => ({
  entityType: attachment.entityType,
  entityId: attachment.entityId,
  name: attachment.name,
  key: attachment.key,
});

/**
 * Step 1 of an upload: the browser declares the file, the server checks the
 * record exists and the size fits the configured cap, then hands back the
 * short-lived upload URL. The cap is enforced again on the stored blob in
 * createAttachment, so a client cannot lie its way past it.
 */
export const generateAttachmentUploadUrl = employeeMutation({
  args: {
    entityType: attachmentEntityTypeValidator,
    entityId: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    await requireEntity(ctx, args.entityType, args.entityId);
    const maxSizeBytes = await attachmentMaxBytes(ctx);
    assertSize(args.size, maxSizeBytes);
    return { uploadUrl: await fileStore('convex').generateUploadUrl(ctx), maxSizeBytes };
  },
});

/**
 * Step 2: register the uploaded blob as an attachment of the record. An
 * oversized blob is deleted and reported as `too_large` rather than thrown:
 * a throwing mutation rolls back its writes, the delete included.
 */
export const createAttachment = employeeMutation({
  args: {
    entityType: attachmentEntityTypeValidator,
    entityId: v.string(),
    storageId: v.id('_storage'),
    folder: v.optional(v.string()),
    name: v.string(),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEntity(ctx, args.entityType, args.entityId);
    const blob = await ctx.db.system.get(args.storageId);
    if (!blob) throw new Error('blob_not_found');
    const maxSizeBytes = await attachmentMaxBytes(ctx);
    if (blob.size > maxSizeBytes) {
      await ctx.storage.delete(args.storageId);
      return { status: 'too_large' as const, maxSizeBytes };
    }
    const folder = normalizeFolder(args.folder);
    const name = normalizeFileName(args.name);
    const attachmentId = await ctx.db.insert('attachments', {
      entityType: args.entityType,
      entityId: args.entityId,
      folder,
      name,
      mimeType: args.mimeType?.trim() || blob.contentType || 'application/octet-stream',
      size: blob.size,
      provider: 'convex',
      storageId: args.storageId,
      key: attachmentKey(args.entityType, args.entityId, folder, name),
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'attachment',
      entityId: attachmentId,
      action: 'create',
      metadata: { entityType: args.entityType, entityId: args.entityId, name, size: blob.size },
    });
    return { status: 'ok' as const, attachmentId };
  },
});

/** Rename a file or move it to another folder of the same record. */
export const updateAttachment = employeeMutation({
  args: {
    attachmentId: v.id('attachments'),
    name: v.optional(v.string()),
    folder: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attachment = await requireAttachment(ctx, args.attachmentId);
    const name = args.name !== undefined ? normalizeFileName(args.name) : attachment.name;
    const folder = args.folder !== undefined ? normalizeFolder(args.folder) : attachment.folder;
    if (name === attachment.name && folder === attachment.folder) return args.attachmentId;
    await ctx.db.patch(args.attachmentId, {
      name,
      folder,
      key: attachmentKey(attachment.entityType, attachment.entityId, folder, name),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'attachment',
      entityId: args.attachmentId,
      action: 'update',
      metadata: {
        from: { name: attachment.name, folder: attachment.folder },
        to: { name, folder },
      },
    });
    return args.attachmentId;
  },
});

/** Soft delete: the row goes to the trash (blob kept) and its purge is scheduled for `purgeAt`. */
export const deleteAttachment = employeeMutation({
  args: { attachmentId: v.id('attachments') },
  handler: async (ctx, args) => {
    const attachment = await requireAttachment(ctx, args.attachmentId);
    const deletedAt = Date.now();
    const purgeAt = attachmentPurgeAt(deletedAt, await attachmentRetentionDays(ctx));
    await ctx.db.patch(args.attachmentId, {
      deletedAt,
      deletedBy: ctx.userId,
      purgeAt,
      ...updateAuditFields(ctx.userId),
    });
    await ctx.scheduler.runAt(purgeAt, internal.features.attachments.internal.purgeAttachmentAt, {
      attachmentId: args.attachmentId,
      purgeAt,
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'attachment',
      entityId: args.attachmentId,
      action: 'delete',
      metadata: auditMeta(attachment),
    });
  },
});

/** Put a trashed file back where it was (same key, same blob); refused once purged. */
export const restoreAttachment = employeeMutation({
  args: { attachmentId: v.id('attachments') },
  handler: async (ctx, args) => {
    const attachment = await requireTrashed(ctx, args.attachmentId);
    // The scheduled purge finds another purgeAt (or a live row) and does nothing.
    await ctx.db.patch(args.attachmentId, {
      deletedAt: undefined,
      deletedBy: undefined,
      purgeAt: undefined,
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'attachment',
      entityId: args.attachmentId,
      action: 'update',
      metadata: { ...auditMeta(attachment), restored: true },
    });
  },
});

/** « Supprimer définitivement » from the trash: the row and its blob go together. */
export const purgeAttachment = employeeMutation({
  args: { attachmentId: v.id('attachments') },
  handler: async (ctx, args) => {
    const attachment = await requireTrashed(ctx, args.attachmentId);
    await fileStore(attachment.provider).delete(ctx, attachment);
    await ctx.db.delete(args.attachmentId);
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'attachment',
      entityId: args.attachmentId,
      action: 'delete',
      metadata: { ...auditMeta(attachment), purged: true },
    });
  },
});
