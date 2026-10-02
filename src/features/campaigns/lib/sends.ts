import { shortDateFormat } from '@crm/lib/format';

/** Build a recipient's display name from the merge values stored on the send. */
export function sendLeadName(params: Record<string, string>): string {
  return `${params.firstName ?? ''} ${params.lastName ?? ''}`.trim();
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Bucket sentAt timestamps by hour (or by day when the span exceeds 48h). */
export function buildSendSeries(sentAts: number[]): { label: string; value: number }[] {
  if (sentAts.length === 0) return [];
  const min = Math.min(...sentAts);
  const max = Math.max(...sentAts);
  const bucketSize = max - min > 2 * DAY ? DAY : HOUR;
  const labelFormat =
    bucketSize === DAY
      ? shortDateFormat
      : new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const buckets = new Map<number, number>();
  for (const t of sentAts) {
    const bucket = Math.floor(t / bucketSize) * bucketSize;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucket, count]) => ({ label: labelFormat.format(bucket), value: count }));
}
