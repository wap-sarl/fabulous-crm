import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@crm/lib/backend';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

export function DeleteRoleDialog({
  role,
  roles,
  onClose,
}: {
  role: RoleRow;
  roles: RoleRow[];
  onClose: () => void;
}) {
  const deleteRole = useMutation(api.features.roles.mutations.deleteRole);
  const others = roles.filter((r) => r.key !== role.key);
  const [replacement, setReplacement] = useState('member');
  const [busy, setBusy] = useState(false);
  const inUse = role.userCount > 0;
  const confirm = async () => {
    setBusy(true);
    try {
      await deleteRole({ key: role.key, replacementKey: inUse ? replacement : undefined });
      toast.success('Rôle supprimé.');
      onClose();
    } catch (e) {
      toast.error(roleErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!inUse) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={`Supprimer le rôle « ${role.label} » ?`}
        description="Aucun utilisateur ne le détient."
        confirmLabel="Supprimer"
        destructive
        onConfirm={confirm}
      />
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer le rôle « {role.label} » ?</DialogTitle>
          <DialogDescription>
            {role.userCount} utilisateur(s) le détiennent : choisissez le rôle qu’ils recevront.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Rôle de remplacement</Label>
          <Select value={replacement} onValueChange={setReplacement}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {others.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button color="destructive" onClick={confirm} loading={busy}>
            Supprimer et réaffecter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
