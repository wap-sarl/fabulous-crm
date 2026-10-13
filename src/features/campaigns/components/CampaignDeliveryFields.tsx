import type { CampaignChannel } from '@crm/lib/backend';
import { DatePicker, HelperText, Label, Switch, TimeInput } from '@crm/design-system';
import type { ScheduleForm } from '../lib/delivery';

/** When the campaign goes: now or at a time on the organisation's clock, and for an e-mail, each recipient at the hour they open most. */
export function CampaignDeliveryFields({
  channel,
  schedule,
  onScheduleChange,
  timeZone,
  optimized,
  onOptimizedChange,
}: {
  channel: CampaignChannel;
  schedule: ScheduleForm;
  onScheduleChange: (next: ScheduleForm) => void;
  timeZone: string;
  optimized: boolean;
  onOptimizedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm font-semibold text-ink">Envoi</span>
      <div className="flex items-center gap-3">
        <Switch
          id="campaign-later"
          checked={schedule.later}
          onCheckedChange={(later) => onScheduleChange({ ...schedule, later })}
        />
        <Label htmlFor="campaign-later">Programmer l’envoi</Label>
      </div>
      {schedule.later && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="campaign-date">Date</Label>
            <DatePicker
              id="campaign-date"
              value={schedule.date}
              onValueChange={(date) => onScheduleChange({ ...schedule, date })}
              disabledDays={{ before: new Date() }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="campaign-time">Heure</Label>
            <TimeInput
              id="campaign-time"
              value={schedule.time}
              onValueChange={(time) => onScheduleChange({ ...schedule, time })}
            />
          </div>
          <HelperText className="pb-2">Heure de l’organisation ({timeZone}).</HelperText>
        </div>
      )}
      {channel === 'email' && (
        <div className="flex items-start gap-3">
          <Switch
            id="campaign-optimized"
            checked={optimized}
            onCheckedChange={onOptimizedChange}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor="campaign-optimized">Envoyer à l’heure où chacun ouvre</Label>
            <HelperText>
              Chaque destinataire reçoit l’e-mail à l’heure de la journée où il ouvre le plus, dans
              les 24 h qui suivent le départ ; sans historique, il le reçoit au départ.
            </HelperText>
          </div>
        </div>
      )}
    </div>
  );
}
