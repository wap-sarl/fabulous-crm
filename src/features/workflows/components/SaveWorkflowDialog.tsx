import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@crm/design-system';
import { RefreshCw, Save } from 'lucide-react';
import type { WorkflowDraft } from '../types';

interface SaveWorkflowDialogProps {
  saveChoiceOpen: boolean;
  setSaveChoiceOpen: (open: boolean) => void;
  submitting: boolean;
  matching: { total: number } | undefined;
  draft: WorkflowDraft;
  handleSave: () => Promise<void>;
  handleSaveAndReenroll: () => Promise<void>;
}

export function SaveWorkflowDialog({
  saveChoiceOpen,
  setSaveChoiceOpen,
  submitting,
  matching,
  draft,
  handleSave,
  handleSaveAndReenroll,
}: SaveWorkflowDialogProps) {
  return (
    <Dialog open={saveChoiceOpen} onOpenChange={(open) => !submitting && setSaveChoiceOpen(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enregistrer le workflow</DialogTitle>
          <DialogDescription>
            Enregistrer simplement les modifications, ou aussi réinscrire les leads qui
            correspondent aux critères d’inscription ?
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="rounded-lg border bg-canvas px-3 py-2 text-body">
            {matching === undefined ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size="sm" /> Calcul des leads correspondants…
              </span>
            ) : (
              <>
                <span className="font-bold text-ink">{matching.total}</span> lead(s)
                correspondant(s){' '}
                {draft.enrollmentCriteria
                  ? 'aux critères d’inscription.'
                  : '— aucun critère : tous les leads sont concernés.'}
              </>
            )}
          </div>
          <p className="text-faint">
            La réinscription annule les parcours en cours et relance chaque lead sur la nouvelle
            version du workflow (même si la réinscription est désactivée).
          </p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            className="w-full"
            variant="outline"
            disabled={submitting}
            onClick={handleSave}
            data-testid="save-only"
          >
            <Save className="size-4" />
            Enregistrer uniquement
          </Button>
          <Button
            className="w-full"
            disabled={submitting || matching === undefined}
            onClick={handleSaveAndReenroll}
            data-testid="save-and-reenroll"
          >
            <RefreshCw className="size-4" />
            Enregistrer et réinscrire {matching ? `${matching.total} lead(s)` : '…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
