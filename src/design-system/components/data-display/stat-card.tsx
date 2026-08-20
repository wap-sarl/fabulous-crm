import * as React from 'react';
import { cn } from '../../theme/utils';

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  /** Small caption under the value. */
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  /** Background tint of the icon square, e.g. 'var(--primary-soft)' or '#E3F6EC'. */
  iconBg?: string;
  /** Color of the icon, e.g. 'var(--primary-strong)'. */
  iconColor?: string;
}

/**
 * Metric card — label top-left, tinted icon square top-right, large mono value.
 */
function StatCard({
  label,
  value,
  sub,
  icon,
  iconBg = 'var(--primary-soft)',
  iconColor = 'var(--primary-strong)',
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn('rounded-xl border bg-card p-4 shadow-card', className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12.5px] font-medium text-faint">{label}</div>
        {icon && (
          <span
            aria-hidden
            className="flex size-[30px] shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"
            style={{ backgroundColor: iconBg, color: iconColor }}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-bold text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export { StatCard };
export type { StatCardProps };
