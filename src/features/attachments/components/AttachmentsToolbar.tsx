import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Button, type DropzoneHandle } from '@crm/design-system';
import { Folder, FolderPlus, Trash2, Upload } from 'lucide-react';

interface AttachmentsToolbarProps {
  showTrash: boolean;
  setShowTrash: Dispatch<SetStateAction<boolean>>;
  trashCount: number;
  setNewFolderOpen: (open: boolean) => void;
  dropzone: RefObject<DropzoneHandle | null>;
  uploading: { done: number; total: number } | null;
}

export function AttachmentsToolbar({
  showTrash,
  setShowTrash,
  trashCount,
  setNewFolderOpen,
  dropzone,
  uploading,
}: AttachmentsToolbarProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-[15px] font-bold text-ink">
        {showTrash ? `Corbeille (${trashCount})` : 'Fichiers'}
      </h2>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTrash((v) => !v)}
          data-testid="attachments-trash-toggle"
        >
          {showTrash ? (
            <>
              <Folder className="size-4" />
              Fichiers
            </>
          ) : (
            <>
              <Trash2 className="size-4" />
              Corbeille{trashCount > 0 ? ` (${trashCount})` : ''}
            </>
          )}
        </Button>
        {!showTrash ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="size-4" />
              Dossier
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dropzone.current?.open()}
              disabled={uploading !== null}
              data-testid="add-attachment"
            >
              <Upload className="size-4" />
              Ajouter
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
