import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@crm/lib/backend';
import { MAX_ROLE_LABEL_LENGTH } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  toast,
} from '@crm/design-system';
import { roleErrorMessage } from '../lib/roleErrors';
import type { RoleRow } from '../types';

export function RenameRoleDialog({ role, onClose }: { role: RoleRow; onClose: () => void }) {
  const updateRole = useMutation(api.features.roles.mutations.updateRole);
  const [label, setLabel] = useState(role.label);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await updateRole({ key: role.key, label });
      toast.success('Rôle renommé.');
      onClose();
    } catch (e) {
      toast.error(roleErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renommer « {role.label} »</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="rename-role">Nom</Label>
          <Input
            id="rename-role"
            value={label}
            maxLength={MAX_ROLE_LABEL_LENGTH}
            onChange={(e) => setLabel(e.target.value)}
          />
          <HelperText>La clé « {role.key} » ne change pas.</HelperText>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy} disabled={!label.trim()}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
