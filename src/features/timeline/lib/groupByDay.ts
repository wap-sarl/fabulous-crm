import type { TimelineEvent } from '@crm/lib/backend';

const dayFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TimelineDayGroup {
  key: string;
  label: string;
  events: TimelineEvent[];
}

function startOfDay(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Groups a newest-first feed by local day, labelled « Aujourd’hui » / « Hier » / date. */
export function groupByDay(events: TimelineEvent[], now = Date.now()): TimelineDayGroup[] {
  const today = startOfDay(now);
  const groups: TimelineDayGroup[] = [];
  for (const event of events) {
    const day = startOfDay(event.at);
    const key = String(day);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.events.push(event);
      continue;
    }
    const label =
      day === today ? 'Aujourd’hui' : day === today - DAY_MS ? 'Hier' : dayFormat.format(day);
    groups.push({ key, label, events: [event] });
  }
  return groups;
}
