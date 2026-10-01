import type { Dispatch } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@crm/design-system';
import { type DraftAction, subtreeIds } from '../hooks/useWorkflowDraft';
import type { WorkflowDraft } from '../types';

interface RemoveBranchDialogProps {
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  draft: WorkflowDraft;
  dispatch: Dispatch<DraftAction>;
}

export function RemoveBranchDialog({
  confirmRemoveId,
  setConfirmRemoveId,
  draft,
  dispatch,
}: RemoveBranchDialogProps) {
  return (
    <Dialog
      open={confirmRemoveId !== null}
      onOpenChange={(open) => !open && setConfirmRemoveId(null)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer la condition ?</DialogTitle>
          <DialogDescription>
            {confirmRemoveId
              ? `Supprimer cette condition supprimera aussi les ${
                  subtreeIds(draft.nodes, confirmRemoveId).length - 1
                } étape(s) qui en dépendent.`
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirmRemoveId(null)}>
            Annuler
          </Button>
          <Button
            color="destructive"
            onClick={() => {
              if (confirmRemoveId) dispatch({ type: 'removeNode', id: confirmRemoveId });
              setConfirmRemoveId(null);
            }}
          >
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
