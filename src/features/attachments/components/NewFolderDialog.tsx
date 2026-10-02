import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@crm/design-system';

export function NewFolderDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const submit = () => {
    const clean = name.trim().replace(/[\\/]+/g, '-');
    if (!clean) {
      toast.error('Nommez le dossier.');
      return;
    }
    onCreate(clean);
    setName('');
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nouveau dossier</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="new-folder-name">Nom</Label>
          <Input
            id="new-folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Devis, Contrats…"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit}>Créer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
