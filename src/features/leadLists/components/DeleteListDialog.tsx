import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  toast,
} from '@crm/design-system';
import { useLeadActions } from '../../leads/hooks/useLeadActions';
import type { LeadListRow } from '../types';

/** Confirmation modal offering "list only" vs "list + leads" deletion. */
export function DeleteListDialog({ list, onDone }: { list: LeadListRow; onDone: () => void }) {
  const { deleteLeadList } = useLeadActions();
  const [busy, setBusy] = useState(false);

  const run = async (deleteLeads: boolean) => {
    setBusy(true);
    try {
      // The mutation deletes members in bounded batches; loop until it's done.
      let done = false;
      while (!done) {
        const res = await deleteLeadList({ listId: list._id, deleteLeads });
        done = res.done;
      }
      toast.success(deleteLeads ? 'Liste et leads supprimés.' : 'Liste supprimée.');
      onDone();
    } catch {
      toast.error('Échec de la suppression.');
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer « {list.name} » ?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-soft">
          Cette liste contient {list.memberCount} lead(s). Voulez-vous aussi supprimer ces leads, ou
          seulement la liste (les leads restent dans le CRM) ?
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button variant="fill" color="destructive" loading={busy} onClick={() => run(true)}>
            Supprimer la liste et ses leads
          </Button>
          <Button variant="outline" loading={busy} onClick={() => run(false)}>
            Supprimer la liste seule
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onDone}>
            Annuler
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
