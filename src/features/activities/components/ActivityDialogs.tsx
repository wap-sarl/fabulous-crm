import { useState } from 'react';
import type { ActivityRow, ActivityType, Id, PropertyValue } from '@crm/lib/backend';
import {
  Button,
  Combobox,
  DatePicker,
  Dialog,
  DialogContent,
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
  Switch,
  Textarea,
  TimeInput,
  toast,
} from '@crm/design-system';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { CustomPropertyFields } from '../../properties/components/CustomPropertyFields';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { ACTIVITY_TYPES, CALL_OUTCOMES } from '../../../lib/constants';
import { activityErrorMessage, useActivityActions } from '../hooks/useActivityActions';
import { fromDueAt, toDueAt } from '../lib/buckets';
import { useTeams } from '../../../lib/hooks/useTeams';

/** Owner picker sentinel: an explicit « nobody » (team task, or a free task for anyone). */
const NOBODY = '__nobody__';

/** The record(s) an activity is attached to. */
export interface ActivityLinks {
  leadId?: Id<'leads'>;
  companyId?: Id<'companies'>;
  dealId?: Id<'deals'>;
}

interface ActivityFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links?: ActivityLinks;
  /** Edit mode when set. */
  activity?: ActivityRow;
  defaultType?: ActivityType;
}

interface FormState {
  type: ActivityType;
  title: string;
  description: string;
  date: string;
  time: string;
  ownerId: string;
  teamId: string;
  customProperties: Record<string, PropertyValue>;
}

export function ActivityFormDialog({
  open,
  onOpenChange,
  links,
  activity,
  defaultType,
}: ActivityFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? (
          <ActivityFormBody
            key={activity?._id ?? 'new'}
            links={links}
            activity={activity}
            defaultType={defaultType}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ActivityFormBody({
  links,
  activity,
  defaultType,
  onOpenChange,
}: Omit<ActivityFormDialogProps, 'open'>) {
  const isEdit = !!activity;
  const { createActivity, updateActivity } = useActivityActions();
  const { employees } = useEmployees();
  const { teams } = useTeams();
  const definitions = usePropertyDefinitions('activity');
  const [form, setForm] = useState<FormState>(() => {
    const due = fromDueAt(activity?.dueAt);
    return {
      type: activity?.type ?? defaultType ?? 'task',
      title: activity?.title ?? '',
      description: activity?.description ?? '',
      date: due.date,
      time: due.time,
      ownerId: activity ? (activity.ownerId ?? NOBODY) : '',
      teamId: activity?.teamId ?? '',
      customProperties: { ...(activity?.customProperties ?? {}) },
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.title.trim()) {
      toast.error('L’intitulé est requis.');
      return;
    }
    const dueAt = toDueAt(form.date, form.time);
    setSubmitting(true);
    try {
      if (isEdit && activity) {
        await updateActivity({
          activityId: activity._id,
          type: form.type,
          title: form.title,
          description: form.description || null,
          dueAt: dueAt ?? null,
          ownerId:
            form.ownerId === NOBODY
              ? null
              : form.ownerId
                ? (form.ownerId as Id<'users'>)
                : undefined,
          teamId: form.teamId ? (form.teamId as Id<'teams'>) : null,
          customProperties: form.customProperties,
        });
        toast.success('Activité mise à jour.');
      } else {
        await createActivity({
          type: form.type,
          title: form.title,
          description: form.description || undefined,
          dueAt,
          ownerId:
            form.ownerId === NOBODY
              ? null
              : form.ownerId
                ? (form.ownerId as Id<'users'>)
                : undefined,
          teamId: form.teamId ? (form.teamId as Id<'teams'>) : undefined,
          customProperties: form.customProperties,
          ...links,
        });
        toast.success('Activité planifiée.');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(activityErrorMessage(e, 'Une erreur est survenue.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Modifier l’activité' : 'Nouvelle activité'}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Type</Label>
          <Select value={form.type} onValueChange={(v) => set('type', v as ActivityType)}>
            <SelectTrigger data-testid="activity-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Propriétaire</Label>
          <Combobox
            items={[
              { value: '', label: 'Moi' },
              { value: NOBODY, label: 'Personne' },
              ...employees.map((e) => ({ value: e._id, label: `${e.firstName} ${e.lastName}` })),
            ]}
            value={form.ownerId}
            onValueChange={(v) => set('ownerId', v)}
            placeholder="Moi"
            modal
            className="w-full"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Équipe</Label>
          <Combobox
            items={[
              { value: '', label: 'Aucune équipe' },
              ...teams.map((t) => ({ value: t._id, label: t.name })),
            ]}
            value={form.teamId}
            onValueChange={(v) => set('teamId', v)}
            placeholder="Aucune équipe"
            modal
            className="w-full"
          />
          <HelperText>Toute l’équipe voit la tâche, avec ou sans propriétaire.</HelperText>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="activity-title">Intitulé *</Label>
          <Input
            id="activity-title"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            data-testid="activity-title"
          />
        </div>
        <div className="space-y-1">
          <Label>Échéance</Label>
          <DatePicker value={form.date} onValueChange={(v) => set('date', v)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="activity-time">Heure</Label>
          <TimeInput
            id="activity-time"
            value={form.time}
            onValueChange={(v) => set('time', v)}
            disabled={!form.date}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="activity-description">Description</Label>
          <Textarea
            id="activity-description"
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
      </div>
      <CustomPropertyFields
        definitions={definitions}
        values={form.customProperties}
        onChange={(id, value) =>
          setForm((prev) => {
            const next = { ...prev.customProperties };
            if (value === undefined) delete next[id];
            else next[id] = value;
            return { ...prev, customProperties: next };
          })
        }
      />
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={submit} loading={submitting} data-testid="submit-activity">
          {isEdit ? 'Enregistrer' : 'Planifier'}
        </Button>
      </DialogFooter>
    </>
  );
}

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
      toast.error(activityErrorMessage(e, 'Une erreur est survenue.'));
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
