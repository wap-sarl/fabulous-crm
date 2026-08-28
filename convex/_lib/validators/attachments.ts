import { type Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';

/** Records a file can be attached to. */
export const attachmentEntityTypeValidator = v.union(
  v.literal('lead'),
  v.literal('company'),
  v.literal('deal'),
);

/**
 * Where the bytes live. `convex` is Convex Storage (today). `s3` is reserved
 * for an object store: rows already carry the object `key` such a store would
 * use, so a migration copies blobs key by key and flips the provider — the
 * folder tree stays navigable by a human in the bucket.
 */
export const storageProviderValidator = v.union(v.literal('convex'), v.literal('s3'));

/**
 * A file attached to a lead, company or deal. Organized in a virtual folder
 * tree per record (`folder`, e.g. `Devis/2026`), mirrored by the object-store
 * `key` (`<entityType>/<entityId>/<folder>/<name>`). `createdBy` is the author.
 * Deleting moves a row to the trash; the blob goes when the row is purged.
 */
export const attachmentValidator = v.object({
  ...logsValidator.fields,
  // Trash: set on delete, cleared on restore. `purgeAt` is when the scheduled purge fires.
  ...softDeleteValidator.fields,
  deletedBy: v.optional(v.id('users')),
  purgeAt: v.optional(v.number()),
  entityType: attachmentEntityTypeValidator,
  entityId: v.string(),
  // '' = the record's root; segments joined by '/', no leading/trailing slash.
  folder: v.string(),
  name: v.string(),
  mimeType: v.string(),
  size: v.number(),
  provider: storageProviderValidator,
  // Set while provider === 'convex'.
  storageId: v.optional(v.id('_storage')),
  key: v.string(),
});

/** Upload size cap and trash retention, stored in appConfig.attachments. */
export const attachmentsConfigValidator = v.object({
  maxSizeBytes: v.number(),
  // Days a deleted file stays restorable before the purge; absent = default.
  retentionDays: v.optional(v.number()),
});

export type AttachmentEntityType = Infer<typeof attachmentEntityTypeValidator>;
export type StorageProvider = Infer<typeof storageProviderValidator>;
export type Attachment = Infer<typeof attachmentValidator>;
export type AttachmentsConfig = Infer<typeof attachmentsConfigValidator>;

export const DEFAULT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_BYTES_CEILING = 200 * 1024 * 1024;

export const DEFAULT_ATTACHMENT_RETENTION_DAYS = 30;
export const ATTACHMENT_RETENTION_MIN_DAYS = 1;
export const ATTACHMENT_RETENTION_MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** When a deleted file gets purged for good. */
export function attachmentPurgeAt(deletedAt: number, retentionDays: number): number {
  return deletedAt + retentionDays * DAY_MS;
}

/** Whole days left before the purge (never negative). */
export function attachmentDaysLeft(purgeAt: number, now: number): number {
  return Math.max(0, Math.ceil((purgeAt - now) / DAY_MS));
}
