import { useState } from 'react';
import type { ActivityRow } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
  toast,
} from '@crm/design-system';
import { activityErrorMessage, useActivityActions } from '../hooks/useActivityActions';

interface CompleteActivityDialogProps {
  activity: ActivityRow | null;
  onClose: () => void;
}

/** Marks an activity done, asking what came out of it. */
export function CompleteActivityDialog({ activity, onClose }: CompleteActivityDialogProps) {
  const { completeActivity } = useActivityActions();
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  if (!activity) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await completeActivity({ activityId: activity._id, outcome: outcome || undefined });
      toast.success('Activité terminée.');
      onClose();
    } catch (e) {
      toast.error(activityErrorMessage(e, 'Échec.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Terminer « {activity.title} »</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="activity-outcome">Résultat (optionnel)</Label>
          <Textarea
            id="activity-outcome"
            rows={3}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder={
              activity.type === 'call' ? 'Répondu, rappel prévu…' : 'Ce qui en est ressorti…'
            }
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy} data-testid="confirm-complete">
            Terminer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
