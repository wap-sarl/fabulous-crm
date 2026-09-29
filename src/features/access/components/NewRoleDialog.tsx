import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@crm/lib/backend';
import { MAX_ROLE_LABEL_LENGTH } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@crm/design-system';
import { roleErrorMessage } from '../lib/roleErrors';
import type { RoleRow } from '../types';

export function NewRoleDialog({ roles, onClose }: { roles: RoleRow[]; onClose: () => void }) {
  const createRole = useMutation(api.features.roles.mutations.createRole);
  const [label, setLabel] = useState('');
  const [copyFrom, setCopyFrom] = useState('member');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const source = roles.find((r) => r.key === copyFrom) ?? roles[0];
      await createRole({ label, access: { ...source.access, settings: false } });
      toast.success('Rôle créé.');
      onClose();
    } catch (e) {
      toast.error(roleErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau rôle</DialogTitle>
          <DialogDescription>
            Les niveaux d’accès sont copiés d’un rôle existant, puis ajustables dans la grille.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="role-label">Nom *</Label>
            <Input
              id="role-label"
              value={label}
              maxLength={MAX_ROLE_LABEL_LENGTH}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Support, Commercial senior…"
              data-testid="role-label"
            />
          </div>
          <div className="space-y-1">
            <Label>Copier les accès de</Label>
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>« Paramètres » reste désactivé pour un nouveau rôle.</HelperText>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!label.trim()}
            data-testid="submit-role"
          >
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
