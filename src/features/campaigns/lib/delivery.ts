import { abSplitPercentSchema, abWindowHoursSchema, follows } from '@crm/lib/backend';
import type { CampaignAbTest } from '@crm/lib/backend';
import { zonedToEpoch } from '@crm/lib/timezone';

/** The composer's A/B test, as typed. */
export type AbTestForm = {
  enabled: boolean;
  kind: CampaignAbTest['kind'];
  subjectB: string;
  htmlBodyB: string;
  splitPercent: string;
  windowHours: string;
  metric: CampaignAbTest['metric'];
};

export const EMPTY_AB_TEST: AbTestForm = {
  enabled: false,
  kind: 'subject',
  subjectB: '',
  htmlBodyB: '',
  splitPercent: '20',
  windowHours: '4',
  metric: 'opens',
};

export type AbTestArgs = Omit<CampaignAbTest, 'winner' | 'decidedAt'>;

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const hasContent = (html: string) =>
  html.replace(/<[^>]*>/g, '').trim() !== '' || /<img/i.test(html);

/** The test the composer sends, nothing when it is off, or the message that stops the submit. */
export function abTestArgsOf(form: AbTestForm): Checked<AbTestArgs | undefined> {
  if (!form.enabled) return { ok: true, value: undefined };
  const subjectB = form.subjectB.trim();
  if (form.kind === 'subject' && !subjectB) {
    return { ok: false, error: 'L’objet de la variante B est requis.' };
  }
  if (form.kind === 'content' && !hasContent(form.htmlBodyB)) {
    return { ok: false, error: 'Le contenu de la variante B est requis.' };
  }
  const splitPercent = Number(form.splitPercent);
  const windowHours = Number(form.windowHours);
  if (!follows(abSplitPercentSchema, splitPercent)) {
    return { ok: false, error: 'La part testée va de 10 à 50 %.' };
  }
  if (!follows(abWindowHoursSchema, windowHours)) {
    return { ok: false, error: 'La fenêtre de test va de 1 à 72 heures.' };
  }
  return {
    ok: true,
    value: {
      kind: form.kind,
      subjectB: form.kind === 'subject' ? subjectB : undefined,
      htmlBodyB: form.kind === 'content' ? form.htmlBodyB : undefined,
      splitPercent,
      windowHours,
      metric: form.metric,
    },
  };
}

/** The composer's schedule, as typed, on the organisation's clock. */
export type ScheduleForm = { later: boolean; date: string; time: string };

/** The instant the campaign starts, nothing for a start at once, or the message that stops the submit. */
export function scheduledAtOf(
  form: ScheduleForm,
  timeZone: string,
  now = Date.now(),
): Checked<number | undefined> {
  if (!form.later) return { ok: true, value: undefined };
  const at = zonedToEpoch(form.date, form.time, timeZone);
  if (at === null) return { ok: false, error: 'Indiquez la date et l’heure d’envoi.' };
  if (at <= now) return { ok: false, error: 'L’heure d’envoi doit être à venir.' };
  return { ok: true, value: at };
}
