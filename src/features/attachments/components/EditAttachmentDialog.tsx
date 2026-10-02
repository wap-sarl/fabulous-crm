import { useState } from 'react';
import type { AttachmentRow } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import { ROOT_LABEL } from '../lib/files';

export function EditAttachmentDialog({
  file,
  folders,
  onClose,
  onSave,
}: {
  file: AttachmentRow;
  folders: string[];
  onClose: () => void;
  onSave: (name: string, folder: string) => Promise<void>;
}) {
  const ROOT = '__root__';
  const [name, setName] = useState(file.name);
  const [folder, setFolder] = useState(file.folder);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renommer / déplacer</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="attachment-name">Nom</Label>
            <Input id="attachment-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Dossier</Label>
            <Select value={folder || ROOT} onValueChange={(v) => setFolder(v === ROOT ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {folders.map((f) => (
                  <SelectItem key={f || ROOT} value={f || ROOT}>
                    {f ? f : ROOT_LABEL}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(name, folder);
              } finally {
                setBusy(false);
              }
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
