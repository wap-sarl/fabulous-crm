import type { AttachmentRow } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@crm/design-system';
import { Download } from 'lucide-react';
import { previewKindOf } from '../lib/files';

export function PreviewDialog({
  file,
  onClose,
}: {
  file: AttachmentRow | null;
  onClose: () => void;
}) {
  const kind = file ? previewKindOf(file.mimeType) : null;
  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file?.name}</DialogTitle>
        </DialogHeader>
        {file?.url && kind === 'image' ? (
          <img src={file.url} alt={file.name} className="max-h-[70vh] w-full object-contain" />
        ) : file?.url && kind === 'pdf' ? (
          <iframe src={file.url} title={file.name} className="h-[70vh] w-full rounded-md border" />
        ) : (
          <p className="text-sm text-faint">Aperçu indisponible.</p>
        )}
        <DialogFooter>
          {file?.url && (
            <Button variant="outline" asChild>
              <a href={file.url} target="_blank" rel="noreferrer" download={file.name}>
                <Download className="size-4" />
                Télécharger
              </a>
            </Button>
          )}
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
