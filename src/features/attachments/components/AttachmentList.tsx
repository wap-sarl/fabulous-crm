import type { AttachmentRow } from '@crm/lib/backend';
import { ChevronRight, Folder } from 'lucide-react';
import { AttachmentFileRow } from './AttachmentFileRow';

interface AttachmentListProps {
  visibleFolders: string[];
  files: AttachmentRow[];
  prefix: string;
  setFolder: (folder: string) => void;
  setPreviewing: (file: AttachmentRow | null) => void;
  setEditing: (file: AttachmentRow | null) => void;
  setDeleting: (file: AttachmentRow | null) => void;
}

export function AttachmentList({
  visibleFolders,
  files,
  prefix,
  setFolder,
  setPreviewing,
  setEditing,
  setDeleting,
}: AttachmentListProps) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {visibleFolders.map((name) => (
        <li key={`folder:${name}`}>
          <button
            type="button"
            onClick={() => setFolder(prefix + name)}
            className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-[#F7F8FA]"
            data-testid="attachment-folder"
          >
            <Folder className="size-4 shrink-0 text-amber-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
              {name}
            </span>
            <ChevronRight className="size-4 text-[#C8CCD4]" aria-hidden />
          </button>
        </li>
      ))}
      {files.map((file) => (
        <AttachmentFileRow
          key={file._id}
          file={file}
          setPreviewing={setPreviewing}
          setEditing={setEditing}
          setDeleting={setDeleting}
        />
      ))}
    </ul>
  );
}
