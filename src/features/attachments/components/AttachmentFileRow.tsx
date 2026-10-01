import type { AttachmentRow } from '@crm/lib/backend';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@crm/design-system';
import { Download, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { dateFormat } from '@crm/lib/format';
import { fileIconOf, formatFileSize, previewKindOf } from '../lib/files';

interface AttachmentFileRowProps {
  file: AttachmentRow;
  setPreviewing: (file: AttachmentRow | null) => void;
  setEditing: (file: AttachmentRow | null) => void;
  setDeleting: (file: AttachmentRow | null) => void;
}

export function AttachmentFileRow({
  file,
  setPreviewing,
  setEditing,
  setDeleting,
}: AttachmentFileRowProps) {
  const Icon = fileIconOf(file.mimeType);
  const canPreview = previewKindOf(file.mimeType) !== null && !!file.url;
  return (
    <li className="flex items-center gap-3 px-1 py-2" data-testid="attachment-item">
      <Icon className="size-4 shrink-0 text-soft" aria-hidden />
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => (canPreview ? setPreviewing(file) : window.open(file.url ?? '', '_blank'))}
          className="block max-w-full truncate text-left text-[13px] font-semibold text-ink hover:underline"
          title={file.name}
        >
          {file.name}
        </button>
        <span className="block truncate text-xs text-faint">
          {formatFileSize(file.size)} · {dateFormat.format(file._creationTime)}
          {file.authorName ? ` · ${file.authorName}` : ''}
        </span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label="Actions" variant="secondary" size="sm">
            <MoreHorizontal className="size-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canPreview && (
            <DropdownMenuItem onSelect={() => setPreviewing(file)}>
              <Eye className="size-4" /> Aperçu
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href={file.url ?? '#'} target="_blank" rel="noreferrer" download={file.name}>
              <Download className="size-4" /> Télécharger
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(file)}>
            <Pencil className="size-4" /> Renommer / déplacer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleting(file)} className="text-destructive">
            <Trash2 className="size-4" /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
