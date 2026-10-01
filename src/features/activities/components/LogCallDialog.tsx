import { useState } from 'react';
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  Switch,
  Textarea,
  TimeInput,
  toast,
} from '@crm/design-system';
import { CALL_OUTCOMES } from '../../../lib/constants';
import { activityErrorMessage, useActivityActions } from '../hooks/useActivityActions';
import { toDueAt } from '../lib/buckets';
import type { ActivityLinks } from '../types';
import { describeError } from '@crm/lib/errors';

interface LogCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: ActivityLinks;
}

/** "Consigner un appel": outcome + notes, optional follow-up task. */
export function LogCallDialog({ open, onOpenChange, links }: LogCallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? <LogCallBody links={links} onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LogCallBody({ links, onOpenChange }: Omit<LogCallDialogProps, 'open'>) {
  const { logCall } = useActivityActions();
  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0]);
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [followUpTitle, setFollowUpTitle] = useState('Rappeler');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('09:00');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await logCall({
        ...links,
        outcome,
        notes: notes || undefined,
        followUp: followUp
          ? {
              title: followUpTitle.trim() || 'Rappeler',
              dueAt: toDueAt(followUpDate, followUpTime),
            }
          : undefined,
      });
      toast.success(followUp ? 'Appel consigné, rappel planifié.' : 'Appel consigné.');
      onOpenChange(false);
    } catch (e) {
      toast.error(activityErrorMessage(e, describeError(e, 'Une erreur est survenue.')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Consigner un appel</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label>Résultat</Label>
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">Résultat de l’appel</legend>
            {CALL_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={outcome === o}
                onClick={() => setOutcome(o)}
                data-testid={`call-outcome-${o}`}
                className={
                  outcome === o
                    ? 'rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-white'
                    : 'rounded-md bg-[#F2F3F5] px-2.5 py-1.5 text-xs font-medium text-soft hover:bg-[#E6E8EC]'
                }
              >
                {o}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="space-y-1">
          <Label htmlFor="call-notes">Notes</Label>
          <Textarea
            id="call-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={followUp} onCheckedChange={setFollowUp} data-testid="call-follow-up" />
          Planifier un rappel
        </label>
        {followUp ? (
          <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="follow-up-title">Tâche</Label>
              <Input
                id="follow-up-title"
                value={followUpTitle}
                onChange={(e) => setFollowUpTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <DatePicker value={followUpDate} onValueChange={setFollowUpDate} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="follow-up-time">Heure</Label>
              <TimeInput
                id="follow-up-time"
                value={followUpTime}
                onValueChange={setFollowUpTime}
                disabled={!followUpDate}
              />
            </div>
            <HelperText>Sans date, le rappel apparaît dans « Sans date ».</HelperText>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={submit} loading={submitting} data-testid="submit-call">
          Enregistrer l’appel
        </Button>
      </DialogFooter>
    </>
  );
}
