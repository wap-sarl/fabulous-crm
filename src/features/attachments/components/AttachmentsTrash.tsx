import type { TrashedAttachmentRow } from '@crm/lib/backend';
import { Button, IconButton, Spinner } from '@crm/design-system';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { dateFormat } from '@crm/lib/format';
import { ROOT_LABEL, fileIconOf } from '../lib/files';
import type { AttachmentLimits } from '../types';

interface AttachmentsTrashProps {
  trash: TrashedAttachmentRow[] | undefined;
  limits: AttachmentLimits | undefined;
  restore: (file: TrashedAttachmentRow) => Promise<void>;
  setPurging: (file: TrashedAttachmentRow | null) => void;
}

export function AttachmentsTrash({ trash, limits, restore, setPurging }: AttachmentsTrashProps) {
  return (
    <section aria-label="Corbeille" data-testid="attachments-trash">
      {trash === undefined ? (
        <Spinner size="sm" />
      ) : trash.length === 0 ? (
        <p className="py-4 text-center text-sm text-faint">La corbeille est vide.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {trash.map((file) => {
            const Icon = fileIconOf(file.mimeType);
            return (
              <li
                key={file._id}
                className="flex items-center gap-3 px-1 py-2"
                data-testid="trashed-attachment-item"
              >
                <Icon className="size-4 shrink-0 text-soft" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[13px] font-semibold text-ink"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {file.folder || ROOT_LABEL} · supprimé le {dateFormat.format(file.deletedAt)}
                    {file.deletedByName ? ` par ${file.deletedByName}` : ''} ·{' '}
                    {file.daysLeft > 0
                      ? `effacé dans ${file.daysLeft} jour${file.daysLeft > 1 ? 's' : ''}`
                      : 'effacement imminent'}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => restore(file)}
                  data-testid="restore-attachment"
                >
                  <ArchiveRestore className="size-4" />
                  Restaurer
                </Button>
                <IconButton
                  variant="secondary"
                  size="sm"
                  aria-label={`Supprimer définitivement ${file.name}`}
                  onClick={() => setPurging(file)}
                  data-testid="purge-attachment"
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {limits ? (
        <p className="mt-2 text-xs text-faint">
          Un fichier supprimé reste restaurable pendant {limits.retentionDays} jour
          {limits.retentionDays > 1 ? 's' : ''}, puis est effacé définitivement.
        </p>
      ) : null}
    </section>
  );
}
