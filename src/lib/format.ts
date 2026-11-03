/** The formatters several screens share; one that a single screen uses stays with it. */
export const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
export const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
export const shortDateFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
});
export const numberFormat = new Intl.NumberFormat('fr-FR');

const relativeTimeFormat = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
const RELATIVE_STEPS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

/** « à l’instant », « il y a 5 minutes », « hier »: the largest unit the distance fills; the future reads as now. */
export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - at);
  const step = RELATIVE_STEPS.find(({ ms }) => elapsed >= ms);
  if (!step) return 'à l’instant';
  return relativeTimeFormat.format(-Math.floor(elapsed / step.ms), step.unit);
}
