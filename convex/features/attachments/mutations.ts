import { follows, nonNegativeSchema } from '../../_lib/validators/fields';
import { refusal } from '../../_lib/refusal';
import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { employeeMutation } from '../../_lib/auth';
import {
  type AttachmentEntityType,
  attachmentEntityTypeValidator,
  EMAIL_IMAGE_MAX_BYTES,
  EMAIL_IMAGE_TYPES,
} from '../../_lib/validators/attachments';
import { createAuditFields, logAudit, updateAuditFields } from '../../lib/audit/log';
import { isNotDeleted } from '../../lib/shared/db';
import {
  attachmentKey,
  attachmentMaxBytes,
  attachmentRetentionDays,
  fileStore,
  normalizeFileName,
  normalizeFolder,
} from '../../lib/attachments/storage';
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
  if (!doc || !isNotDeleted(doc)) throw refusal(`${entityType}_not_found`);
}

function assertSize(size: number, max: number): void {
  if (!follows(nonNegativeSchema, size)) throw refusal('invalid_file_size');
  if (size > max) throw refusal('attachment_too_large', { reason: String(max) });
}

/** A live (not trashed) attachment, or throw. */
async function requireAttachment(ctx: MutationCtx, id: Doc<'attachments'>['_id']) {
  const attachment = await ctx.db.get(id);
  if (!attachment || attachment.deletedAt !== undefined) throw refusal('attachment_not_found');
  return attachment;
}

/** A trashed attachment, or throw (`attachment_not_found` once purged, `attachment_not_deleted` if live). */
async function requireTrashed(ctx: MutationCtx, id: Doc<'attachments'>['_id']) {
  const attachment = await ctx.db.get(id);
  if (!attachment) throw refusal('attachment_not_found');
  if (attachment.deletedAt === undefined) throw refusal('attachment_not_deleted');
  return attachment;
}

const auditMeta = (attachment: Doc<'attachments'>) => ({
  entityType: attachment.entityType,
  entityId: attachment.entityId,
  name: attachment.name,
  key: attachment.key,
});

/** Step 1 of an upload: the declared size is checked here, and again on the stored blob in createAttachment, so a client cannot lie its way past the cap. */
export const generateAttachmentUploadUrl = employeeMutation({
  args: {
    entityType: attachmentEntityTypeValidator,
    entityId: v.string(),
    size: v.number(),
  },
  returns: v.object({ uploadUrl: v.string(), maxSizeBytes: v.number() }),
  handler: async (ctx, args) => {
    await requireEntity(ctx, args.entityType, args.entityId);
    const maxSizeBytes = await attachmentMaxBytes(ctx);
    assertSize(args.size, maxSizeBytes);
    return { uploadUrl: await fileStore('convex').generateUploadUrl(ctx), maxSizeBytes };
  },
});

/** The upload address of one image of an e-mail body (a Claude Design export); the blob is checked and recorded by registerEmailImage right after. */
export const generateEmailImageUploadUrl = employeeMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Records an uploaded image, raster and bounded, for its uploader, and gives its public URL; the declared type must be the one the upload carried. A blob that is not such an image is deleted and reported, not thrown, as a throwing mutation would roll the delete back; one that belongs to a record's file is refused untouched. */
export const registerEmailImage = employeeMutation({
  args: { storageId: v.id('_storage'), contentType: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), imageId: v.id('emailImages'), url: v.string() }),
    v.object({ ok: v.literal(false), code: v.union(v.literal('type'), v.literal('too_large')) }),
  ),
  handler: async (ctx, { storageId, contentType }) => {
    const blob = await ctx.db.system.get(storageId);
    if (!blob) throw refusal('email_image_not_found');
    const ownedByRecord = await ctx.db
      .query('attachments')
      .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
      .first();
    const registered = await ctx.db
      .query('emailImages')
      .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
      .first();
    if (ownedByRecord || registered) throw refusal('email_image_not_found');
    // The store keeps the Content-Type of the upload; the declared one stands in where it did not.
    const type = blob.contentType ?? contentType;
    if (type !== contentType || !EMAIL_IMAGE_TYPES.has(type)) {
      await ctx.storage.delete(storageId);
      return { ok: false as const, code: 'type' as const };
    }
    if (blob.size > EMAIL_IMAGE_MAX_BYTES) {
      await ctx.storage.delete(storageId);
      return { ok: false as const, code: 'too_large' as const };
    }
    const imageId = await ctx.db.insert('emailImages', {
      storageId,
      uploadedBy: ctx.userId,
      contentType: type,
      size: blob.size,
      createdAt: Date.now(),
    });
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw refusal('email_image_not_found');
    return { ok: true as const, imageId, url };
  },
});

/** The images of a campaign just created, claimed by it so the purge leaves them; only the caller's own uploads are in reach. */
export const claimEmailImages = employeeMutation({
  args: { campaignId: v.id('campaigns'), imageIds: v.array(v.id('emailImages')) },
  returns: v.null(),
  handler: async (ctx, { campaignId, imageIds }) => {
    if (!(await ctx.db.get(campaignId))) throw refusal('campaign_not_found');
    for (const imageId of imageIds) {
      const image = await ctx.db.get(imageId);
      if (image && image.campaignId === undefined) await ctx.db.patch(imageId, { campaignId });
    }
    return null;
  },
});

/** Step 2 of an upload: an oversized blob is deleted and reported as `too_large`, not thrown, as a throwing mutation rolls back its writes, the delete included. */
export const createAttachment = employeeMutation({
  args: {
    entityType: attachmentEntityTypeValidator,
    entityId: v.string(),
    storageId: v.id('_storage'),
    folder: v.optional(v.string()),
    name: v.string(),
    mimeType: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ status: v.literal('too_large'), maxSizeBytes: v.number() }),
    v.object({ status: v.literal('ok'), attachmentId: v.id('attachments') }),
  ),
  handler: async (ctx, args) => {
    await requireEntity(ctx, args.entityType, args.entityId);
    const blob = await ctx.db.system.get(args.storageId);
    if (!blob) throw refusal('blob_not_found');
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
  returns: v.id('attachments'),
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
  returns: v.null(),
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
    return null;
  },
});

/** Put a trashed file back where it was (same key, same blob); refused once purged. */
export const restoreAttachment = employeeMutation({
  args: { attachmentId: v.id('attachments') },
  returns: v.null(),
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
    return null;
  },
});

/** « Supprimer définitivement » from the trash: the row and its blob go together. */
export const purgeAttachment = employeeMutation({
  args: { attachmentId: v.id('attachments') },
  returns: v.null(),
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
    return null;
  },
});
