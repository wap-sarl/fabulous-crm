/** Dates read on the organisation's clock: a scheduled campaign is typed and shown in its zone, whatever the browser's. */

const PARTS = new Map<string, Intl.DateTimeFormat>();
const partsFormat = (timeZone: string) => {
  let format = PARTS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    PARTS.set(timeZone, format);
  }
  return format;
};

/** The wall clock of an instant in the zone, as the pickers hold it: `yyyy-MM-dd` and `HH:mm`. */
export function epochToZoned(at: number, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    partsFormat(timeZone)
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** The same wall clock read as UTC, to measure the zone's offset at that instant. */
function wallClockAsUtc(at: number, timeZone: string): number {
  const { date, time } = epochToZoned(at, timeZone);
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
}

/** The instant of a wall clock in the zone; null for a date or time that does not parse. Across a change of daylight-saving time the offset is read twice, so the second reading lands on the right side. */
export function zonedToEpoch(date: string, time: string, timeZone: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);
  // `Date.UTC` would roll a 13th month over: a part out of its range is no date.
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - (wallClockAsUtc(asUtc, timeZone) - asUtc);
  const second = asUtc - (wallClockAsUtc(first, timeZone) - first);
  return second;
}

const ZONE_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** An instant written in the zone, date and time. */
export function formatInZone(at: number, timeZone: string): string {
  let format = ZONE_FORMATS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    ZONE_FORMATS.set(timeZone, format);
  }
  return format.format(at);
}

/** Every zone the browser knows, the current one first when it is not listed. */
export function timeZoneOptions(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const known = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  return known.includes(current) ? known : [current, ...known];
}
