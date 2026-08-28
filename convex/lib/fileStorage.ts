import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  type AttachmentEntityType,
  DEFAULT_ATTACHMENT_MAX_BYTES,
  DEFAULT_ATTACHMENT_RETENTION_DAYS,
  type StorageProvider,
} from '../_lib/validators/attachments';

/**
 * Where attachment bytes live, behind one small interface. Today only Convex
 * Storage exists; an object store (S3, R2, MinIO…) plugs in as a second
 * {@link FileStore} keyed by {@link StorageProvider}. Because every attachment
 * row already carries an object-store shaped `key` (see {@link attachmentKey})
 * the migration is: copy each blob to its key, flip `provider`. The virtual
 * folder tree users build in the UI becomes real directories in the bucket.
 */
export interface FileStore {
  /** A short-lived URL the browser POSTs the file to. */
  generateUploadUrl(ctx: MutationCtx): Promise<string>;
  /** A URL the browser can read (preview / download) — null when the blob is gone. */
  getUrl(ctx: QueryCtx | MutationCtx, attachment: Doc<'attachments'>): Promise<string | null>;
  /** Remove the bytes. Idempotent. */
  delete(ctx: MutationCtx, attachment: Doc<'attachments'>): Promise<void>;
}

const convexStore: FileStore = {
  generateUploadUrl: (ctx) => ctx.storage.generateUploadUrl(),
  getUrl: (ctx, attachment) =>
    attachment.storageId ? ctx.storage.getUrl(attachment.storageId) : Promise.resolve(null),
  delete: async (ctx, attachment) => {
    if (!attachment.storageId) return;
    if (await ctx.db.system.get(attachment.storageId))
      await ctx.storage.delete(attachment.storageId);
  },
};

export function fileStore(provider: StorageProvider): FileStore {
  if (provider === 'convex') return convexStore;
  // Reserved: implement with the bucket client and register it here.
  throw new Error(`storage_provider_not_implemented: ${provider}`);
}

const MAX_FOLDER_DEPTH = 8;
const MAX_SEGMENT_LENGTH = 64;
const MAX_NAME_LENGTH = 200;

/**
 * Canonical folder path: segments joined by '/', trimmed, without empty or
 * dot segments; '' is the root. Throws `invalid_folder` on anything an object
 * store could not use as a prefix.
 */
export function normalizeFolder(raw: string | undefined): string {
  const segments = (raw ?? '')
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length > MAX_FOLDER_DEPTH) throw new Error('invalid_folder');
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.length > MAX_SEGMENT_LENGTH) {
      throw new Error('invalid_folder');
    }
  }
  return segments.join('/');
}

/** A safe file name: no path separators, bounded, never empty. */
export function normalizeFileName(raw: string): string {
  const name = raw
    .trim()
    .replace(/[\\/]+/g, '-')
    .slice(0, MAX_NAME_LENGTH);
  if (!name || name === '.' || name === '..') throw new Error('invalid_file_name');
  return name;
}

/** The object-store key of an attachment: `<entityType>/<entityId>/<folder>/<name>`. */
export function attachmentKey(
  entityType: AttachmentEntityType,
  entityId: string,
  folder: string,
  name: string,
): string {
  return [entityType, entityId, ...(folder ? [folder] : []), name].join('/');
}

/** The configured upload cap. */
export async function attachmentMaxBytes(ctx: QueryCtx | MutationCtx): Promise<number> {
  const cfg = await ctx.db.query('appConfig').first();
  return cfg?.attachments?.maxSizeBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES;
}

/** Days a deleted attachment stays in the trash. */
export async function attachmentRetentionDays(ctx: QueryCtx | MutationCtx): Promise<number> {
  const cfg = await ctx.db.query('appConfig').first();
  return cfg?.attachments?.retentionDays ?? DEFAULT_ATTACHMENT_RETENTION_DAYS;
}
