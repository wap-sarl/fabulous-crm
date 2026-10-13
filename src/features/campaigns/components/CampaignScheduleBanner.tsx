import { useEffect, useState } from 'react';
import { api } from '@crm/lib/backend';
import type { Doc } from '@crm/lib/backend';
import { useAuthMutation } from '@crm/widgets';
import {
  Button,
  ConfirmDialog,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Label,
  TimeInput,
  toast,
} from '@crm/design-system';
import { CalendarClock, Send, XCircle } from 'lucide-react';
import { epochToZoned, formatInZone } from '@crm/lib/timezone';
import { retryErrorMessage } from '../lib/retryErrors';
import { scheduledAtOf } from '../lib/delivery';

const MINUTE = 60_000;

/** How long until `at`, in days, hours and minutes, refreshed every minute. */
function useCountdown(at: number | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);
  if (at === undefined) return '';
  const left = Math.max(0, at - now);
  const days = Math.floor(left / (24 * 60 * MINUTE));
  const hours = Math.floor((left % (24 * 60 * MINUTE)) / (60 * MINUTE));
  const minutes = Math.ceil((left % (60 * MINUTE)) / MINUTE);
  if (left === 0) return 'imminent';
  return `dans ${days > 0 ? `${days} j ` : ''}${days > 0 || hours > 0 ? `${hours} h ` : ''}${minutes} min`;
}

/** A campaign that waits for its time, or waits for one: the countdown and the three ways out. */
export function CampaignScheduleBanner({
  campaign,
  timeZone,
}: {
  campaign: Doc<'campaigns'>;
  timeZone: string;
}) {
  const schedule = useAuthMutation(api.features.campaigns.mutations.scheduleCampaign);
  const cancel = useAuthMutation(api.features.campaigns.mutations.cancelScheduledCampaign);
  const [busy, setBusy] = useState(false);
  const [confirmNow, setConfirmNow] = useState(false);
  const [picking, setPicking] = useState(false);
  const [form, setForm] = useState(() => ({
    later: true,
    ...epochToZoned(campaign.scheduledAt ?? Date.now() + 60 * MINUTE, timeZone),
  }));
  const countdown = useCountdown(campaign.scheduledAt);
  const scheduled = campaign.status === 'scheduled';

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(retryErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reschedule = async () => {
    const checked = scheduledAtOf(form, timeZone);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    setPicking(false);
    await run(
      () => schedule({ campaignId: campaign._id, scheduledAt: checked.value ?? null }),
      'Envoi programmé.',
    );
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm text-info">
      <span className="inline-flex items-center gap-2">
        <CalendarClock className="size-4" aria-hidden="true" />
        {scheduled && campaign.scheduledAt !== undefined ? (
          <span>
            Envoi programmé le <strong>{formatInZone(campaign.scheduledAt, timeZone)}</strong> (
            {timeZone}), {countdown}. Les destinataires seront résolus à ce moment-là.
          </span>
        ) : (
          <span>Envoi annulé : la campagne attend une nouvelle date, ou un envoi immédiat.</span>
        )}
      </span>
      <span className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setPicking(true)} disabled={busy}>
          <CalendarClock className="size-4" aria-hidden="true" />
          {scheduled ? 'Reprogrammer' : 'Programmer'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirmNow(true)} disabled={busy}>
          <Send className="size-4" aria-hidden="true" />
          Envoyer maintenant
        </Button>
        {scheduled && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => cancel({ campaignId: campaign._id }), 'Envoi annulé.')}
          >
            <XCircle className="size-4" aria-hidden="true" />
            Annuler l’envoi
          </Button>
        )}
      </span>
      <ConfirmDialog
        open={confirmNow}
        onOpenChange={setConfirmNow}
        title="Envoyer la campagne maintenant ?"
        description="Les destinataires sont résolus tout de suite et l’envoi démarre."
        confirmLabel="Envoyer"
        onConfirm={async () => {
          setConfirmNow(false);
          await run(
            () => schedule({ campaignId: campaign._id, scheduledAt: null }),
            'Envoi lancé : préparation des destinataires en cours.',
          );
        }}
      />
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{scheduled ? 'Reprogrammer l’envoi' : 'Programmer l’envoi'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="reschedule-date">Date</Label>
              <DatePicker
                id="reschedule-date"
                value={form.date}
                onValueChange={(date) => setForm((f) => ({ ...f, date }))}
                disabledDays={{ before: new Date() }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reschedule-time">Heure</Label>
              <TimeInput
                id="reschedule-time"
                value={form.time}
                onValueChange={(time) => setForm((f) => ({ ...f, time }))}
              />
            </div>
          </div>
          <HelperText>Heure de l’organisation ({timeZone}).</HelperText>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPicking(false)}>
              Annuler
            </Button>
            <Button onClick={reschedule} loading={busy}>
              Programmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
