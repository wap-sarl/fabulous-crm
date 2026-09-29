import { Card } from '@crm/design-system';
import { fmt } from '../lib/jobFormat';

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'amber' | 'red';
}) {
  return (
    <Card className="p-3">
      <p className="text-xs text-soft">{label}</p>
      <p
        className={
          tone === 'red'
            ? 'text-lg font-semibold text-red-600'
            : tone === 'amber'
              ? 'text-lg font-semibold text-amber-600'
              : 'text-lg font-semibold'
        }
      >
        {fmt.format(value)}
      </p>
    </Card>
  );
}
