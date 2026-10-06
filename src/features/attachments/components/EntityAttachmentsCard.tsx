import { memo, useRef, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { AttachmentEntityType, AttachmentRow, TrashedAttachmentRow } from '@crm/lib/backend';
import { Card, ConfirmDialog, Spinner, cn, toast } from '@crm/design-system';
import { attachmentErrorMessage, useAttachmentActions } from '../hooks/useAttachmentActions';
import { ROOT_LABEL, allFolders, folderContents, formatFileSize } from '../lib/files';
import { AttachmentList } from './AttachmentList';
import { AttachmentsToolbar } from './AttachmentsToolbar';
import { AttachmentsTrash } from './AttachmentsTrash';
import { EditAttachmentDialog } from './EditAttachmentDialog';
import { FolderBreadcrumbs } from './FolderBreadcrumbs';
import { NewFolderDialog } from './NewFolderDialog';
import { PreviewDialog } from './PreviewDialog';

interface EntityAttachmentsCardProps {
  entityType: AttachmentEntityType;
  entityId: string;
}

/** The folder tree shown is the one an object store would show: a folder is only the path of its files. */
// Memoised on the record: a dialog of the page that opens does not re-render the files.
export const EntityAttachmentsCard = memo(function EntityAttachmentsCard({
  entityType,
  entityId,
}: EntityAttachmentsCardProps) {
  const rows = useAuthQuery(api.features.attachments.queries.listAttachments, {
    entityType,
    entityId,
  });
  const trash = useAuthQuery(api.features.attachments.queries.listDeletedAttachments, {
    entityType,
    entityId,
  });
  const limits = useAuthQuery(api.features.attachments.queries.getAttachmentLimits, {});
  const { uploadFile, updateAttachment, deleteAttachment, restoreAttachment, purgeAttachment } =
    useAttachmentActions();
  const [folder, setFolder] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [purging, setPurging] = useState<TrashedAttachmentRow | null>(null);
  // Folders exist only through their files; a freshly created one lives here until a file lands in it.
  const [draftFolders, setDraftFolders] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [previewing, setPreviewing] = useState<AttachmentRow | null>(null);
  const [editing, setEditing] = useState<AttachmentRow | null>(null);
  const [deleting, setDeleting] = useState<AttachmentRow | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = rows ?? [];
  const { subfolders, files } = folderContents(all, folder);
  const prefix = folder ? `${folder}/` : '';
  const draftHere = draftFolders
    .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
    .map((f) => f.slice(prefix.length))
    .filter((f) => !subfolders.includes(f));
  const visibleFolders = [...subfolders, ...draftHere].sort((a, b) => a.localeCompare(b, 'fr'));

  const handleFiles = async (list: FileList | File[]) => {
    const picked = Array.from(list);
    if (picked.length === 0) return;
    const max = limits?.maxSizeBytes;
    const tooBig = max ? picked.filter((f) => f.size > max) : [];
    if (tooBig.length > 0) {
      toast.error(
        `${tooBig.map((f) => f.name).join(', ')} : fichier trop volumineux (maximum ${formatFileSize(max ?? 0)}).`,
      );
    }
    const accepted = picked.filter((f) => !tooBig.includes(f));
    if (accepted.length === 0) return;
    setUploading({ done: 0, total: accepted.length });
    let failed = 0;
    for (const [i, file] of accepted.entries()) {
      try {
        await uploadFile(entityType, entityId, file, folder);
      } catch (e) {
        failed++;
        toast.error(`${file.name} : ${attachmentErrorMessage(e, 'échec de l’envoi.')}`);
      }
      setUploading({ done: i + 1, total: accepted.length });
    }
    setUploading(null);
    if (accepted.length - failed > 0) {
      toast.success(`${accepted.length - failed} fichier(s) ajouté(s).`);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteAttachment({ attachmentId: deleting._id });
      toast.success('Fichier placé dans la corbeille.');
    } catch (e) {
      toast.error(attachmentErrorMessage(e, 'Échec de la suppression.'));
    } finally {
      setDeleting(null);
    }
  };
  const restore = async (file: TrashedAttachmentRow) => {
    try {
      await restoreAttachment({ attachmentId: file._id });
      toast.success(`« ${file.name} » restauré dans ${file.folder || ROOT_LABEL}.`);
    } catch (e) {
      toast.error(attachmentErrorMessage(e, 'Échec de la restauration.'));
    }
  };
  const purge = async () => {
    if (!purging) return;
    try {
      await purgeAttachment({ attachmentId: purging._id });
      toast.success('Fichier supprimé définitivement.');
    } catch (e) {
      toast.error(attachmentErrorMessage(e, 'Échec de la suppression.'));
    } finally {
      setPurging(null);
    }
  };
  const trashCount = trash?.length ?? 0;

  return (
    <Card className="p-5" data-testid="entity-attachments-card">
      <AttachmentsToolbar
        showTrash={showTrash}
        setShowTrash={setShowTrash}
        trashCount={trashCount}
        setNewFolderOpen={setNewFolderOpen}
        inputRef={inputRef}
        uploading={uploading}
        handleFiles={handleFiles}
      />

      {showTrash ? (
        <AttachmentsTrash trash={trash} limits={limits} restore={restore} setPurging={setPurging} />
      ) : null}

      <FolderBreadcrumbs showTrash={showTrash} folder={folder} setFolder={setFolder} />

      <section
        aria-label="Dépôt de fichiers"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'rounded-md border border-dashed p-2 transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
          showTrash && 'hidden',
        )}
        data-testid="attachments-dropzone"
      >
        {rows === undefined ? (
          <Spinner size="sm" />
        ) : visibleFolders.length === 0 && files.length === 0 ? (
          <p className="py-4 text-center text-sm text-faint">
            Glissez des fichiers ici{limits ? ` (max ${formatFileSize(limits.maxSizeBytes)})` : ''}.
          </p>
        ) : (
          <AttachmentList
            visibleFolders={visibleFolders}
            files={files}
            prefix={prefix}
            setFolder={setFolder}
            setPreviewing={setPreviewing}
            setEditing={setEditing}
            setDeleting={setDeleting}
          />
        )}
        {uploading && (
          <p className="mt-2 flex items-center gap-2 text-xs text-faint">
            <Spinner size="sm" /> Envoi… {uploading.done}/{uploading.total}
          </p>
        )}
      </section>

      <PreviewDialog file={previewing} onClose={() => setPreviewing(null)} />
      {editing && (
        <EditAttachmentDialog
          file={editing}
          folders={[...new Set([...allFolders(all), ...draftFolders])].sort()}
          onClose={() => setEditing(null)}
          onSave={async (name, target) => {
            try {
              await updateAttachment({ attachmentId: editing._id, name, folder: target });
              toast.success('Fichier mis à jour.');
              setEditing(null);
            } catch (e) {
              toast.error(attachmentErrorMessage(e, 'Échec.'));
            }
          }}
        />
      )}
      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreate={(name) => {
          const path = prefix + name;
          setDraftFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
          setFolder(path);
          setNewFolderOpen(false);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Supprimer « ${deleting?.name ?? ''} » ?`}
        description={`Le fichier est placé dans la corbeille et reste restaurable pendant ${limits?.retentionDays ?? 30} jours, puis est effacé définitivement.`}
        confirmLabel="Supprimer"
        destructive
        onConfirm={remove}
      />
      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(o) => !o && setPurging(null)}
        title={`Supprimer définitivement « ${purging?.name ?? ''} » ?`}
        description="Le fichier et son contenu sont effacés pour de bon ; il n’y a pas de retour possible."
        confirmLabel="Supprimer définitivement"
        destructive
        onConfirm={purge}
      />
    </Card>
  );
});
