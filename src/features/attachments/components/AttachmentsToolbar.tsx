import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Button } from '@crm/design-system';
import { Folder, FolderPlus, Trash2, Upload } from 'lucide-react';

interface AttachmentsToolbarProps {
  showTrash: boolean;
  setShowTrash: Dispatch<SetStateAction<boolean>>;
  trashCount: number;
  setNewFolderOpen: (open: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  uploading: { done: number; total: number } | null;
  handleFiles: (list: FileList | File[]) => Promise<void>;
}

export function AttachmentsToolbar({
  showTrash,
  setShowTrash,
  trashCount,
  setNewFolderOpen,
  inputRef,
  uploading,
  handleFiles,
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
              onClick={() => inputRef.current?.click()}
              disabled={uploading !== null}
              data-testid="add-attachment"
            >
              <Upload className="size-4" />
              Ajouter
            </Button>
          </>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
