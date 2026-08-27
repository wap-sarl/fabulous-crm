import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { AttachmentEntityType, Id } from '@crm/lib/backend';
import { formatFileSize } from '../lib/files';

/** Attachment mutations plus the two-step upload (URL, POST, register). */
export function useAttachmentActions() {
  const generateUploadUrl = useAuthMutation(
    api.features.attachments.mutations.generateAttachmentUploadUrl,
  );
  const createAttachment = useAuthMutation(api.features.attachments.mutations.createAttachment);
  const updateAttachment = useAuthMutation(api.features.attachments.mutations.updateAttachment);
  const deleteAttachment = useAuthMutation(api.features.attachments.mutations.deleteAttachment);

  const uploadFile = async (
    entityType: AttachmentEntityType,
    entityId: string,
    file: File,
    folder: string,
  ): Promise<Id<'attachments'>> => {
    const { uploadUrl } = await generateUploadUrl({ entityType, entityId, size: file.size });
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw new Error(`upload_failed_${res.status}`);
    const { storageId } = (await res.json()) as { storageId: Id<'_storage'> };
    const result = await createAttachment({
      entityType,
      entityId,
      storageId,
      folder,
      name: file.name,
      mimeType: file.type || undefined,
    });
    if (result.status === 'too_large') {
      throw new Error(`attachment_too_large:${result.maxSizeBytes}`);
    }
    return result.attachmentId;
  };

  return { uploadFile, updateAttachment, deleteAttachment };
}

export function attachmentErrorMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : String(e);
  const tooLarge = /attachment_too_large:(\d+)/.exec(message);
  if (tooLarge) return `Fichier trop volumineux (maximum ${formatFileSize(Number(tooLarge[1]))}).`;
  if (message.includes('invalid_folder')) return 'Nom de dossier invalide.';
  if (message.includes('invalid_file_name')) return 'Nom de fichier invalide.';
  if (message.includes('_not_found')) return 'La fiche ou le fichier n’existe plus.';
  if (message.includes('upload_failed')) return 'L’envoi du fichier a échoué.';
  return fallback;
}
