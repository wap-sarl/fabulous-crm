export type TaskBucket = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'done';

export const TASK_BUCKETS: { value: TaskBucket; label: string }[] = [
  { value: 'overdue', label: 'En retard' },
  { value: 'today', label: 'Aujourd’hui' },
  { value: 'week', label: 'Cette semaine' },
  { value: 'later', label: 'Plus tard' },
  { value: 'undated', label: 'Sans date' },
  { value: 'done', label: 'Terminées' },
];

export interface DayBounds {
  startOfToday: number;
  endOfToday: number;
  endOfWeek: number;
}

export function dayBounds(now = new Date()): DayBounds {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(start);
  endOfToday.setDate(start.getDate() + 1);
  // Monday-based week: days until next Monday.
  const dow = (start.getDay() + 6) % 7;
  const endOfWeek = new Date(start);
  endOfWeek.setDate(start.getDate() + (7 - dow));
  return {
    startOfToday: start.getTime(),
    endOfToday: endOfToday.getTime(),
    endOfWeek: endOfWeek.getTime(),
  };
}

/** Query window of a bucket (undefined bounds = unbounded on that side). */
export function bucketWindow(
  bucket: TaskBucket,
  bounds: DayBounds,
): { status: 'open' | 'done'; dueFrom?: number; dueBefore?: number; undated?: boolean } {
  switch (bucket) {
    case 'overdue':
      return { status: 'open', dueBefore: bounds.startOfToday };
    case 'today':
      return { status: 'open', dueFrom: bounds.startOfToday, dueBefore: bounds.endOfToday };
    case 'week':
      return { status: 'open', dueFrom: bounds.endOfToday, dueBefore: bounds.endOfWeek };
    case 'later':
      return { status: 'open', dueFrom: bounds.endOfWeek };
    case 'undated':
      return { status: 'open', undated: true };
    case 'done':
      return { status: 'done' };
  }
}

/** 'YYYY-MM-DD' + 'HH:mm' (local) → ms; empty date → undefined. */
export function toDueAt(date: string, time: string): number | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '09:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

/** ms → { date: 'YYYY-MM-DD', time: 'HH:mm' } (local). */
export function fromDueAt(dueAt: number | undefined): { date: string; time: string } {
  if (dueAt === undefined) return { date: '', time: '' };
  const d = new Date(dueAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
