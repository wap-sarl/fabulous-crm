import { shortDateFormat } from '@crm/lib/format';

/** Build a recipient's display name from the merge values stored on the send. */
export function sendLeadName(params: Record<string, string>): string {
  return `${params.firstName ?? ''} ${params.lastName ?? ''}`.trim();
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The sends over time from the hourly buckets the campaign keeps, gathered by day when they span more than 48h. */
export function buildSendSeries(
  sentByHour: Record<string, number>,
): { label: string; value: number }[] {
  const hours = Object.entries(sentByHour).map(([hour, count]) => [Number(hour), count] as const);
  if (hours.length === 0) return [];
  const min = Math.min(...hours.map(([hour]) => hour));
  const max = Math.max(...hours.map(([hour]) => hour));
  const bucketSize = max - min > 2 * DAY ? DAY : HOUR;
  const labelFormat =
    bucketSize === DAY
      ? shortDateFormat
      : new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const buckets = new Map<number, number>();
  for (const [hour, count] of hours) {
    const bucket = Math.floor(hour / bucketSize) * bucketSize;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + count);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucket, count]) => ({ label: labelFormat.format(bucket), value: count }));
}
