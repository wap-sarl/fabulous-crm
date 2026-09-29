import { numberFormat } from '@crm/lib/format';
import { Card } from '@crm/design-system';

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
        {numberFormat.format(value)}
      </p>
    </Card>
  );
}
