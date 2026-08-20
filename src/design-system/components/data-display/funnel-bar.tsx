import * as React from 'react';
import { cn } from '../../theme/utils';

interface FunnelBarProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  count: number;
  /** 0–100. Drives both the displayed percentage and the bar width. */
  percent: number;
  /** Bar fill color. @default 'var(--chart-1)' */
  color?: string;
}

const numberFormat = new Intl.NumberFormat('fr-FR');

/**
 * One conversion-funnel stage: label, mono "count · pct", 10px progress bar.
 */
function FunnelBar({ label, count, percent, color = 'var(--chart-1)', className, ...props }: FunnelBarProps) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-body">{label}</span>
        <span className="font-mono text-xs text-soft">
          {numberFormat.format(count)} · {pct.toFixed(pct < 10 ? 1 : 0)}%
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-[6px] bg-secondary">
        <div
          className="h-full rounded-[6px] transition-[width]"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export { FunnelBar };
export type { FunnelBarProps };
