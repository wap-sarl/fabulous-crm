import type * as React from 'react';
import { cn } from '../../theme/utils';

type StatusTone = 'blue' | 'amber' | 'violet' | 'green' | 'red' | 'gray';

const TONE_STYLES: Record<StatusTone, { bg: string; fg: string }> = {
  blue: { bg: '#E7F0FF', fg: '#1D6BE0' },
  amber: { bg: '#FCF1DD', fg: '#B4740A' },
  violet: { bg: '#EFEBFE', fg: '#6A4BF0' },
  green: { bg: '#E3F6EC', fg: '#0C8A43' },
  red: { bg: '#FBE9E9', fg: '#D23B3F' },
  gray: { bg: '#F0F1F3', fg: '#6B7280' },
};

interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  /** Hide the leading dot (defaults to shown). */
  withDot?: boolean;
}

/**
 * Pill status badge with a leading dot in the foreground color.
 */
function StatusBadge({ tone, withDot = true, className, children, ...props }: StatusBadgeProps) {
  const { bg, fg } = TONE_STYLES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold',
        className,
      )}
      style={{ backgroundColor: bg, color: fg }}
      {...props}
    >
      {withDot && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: fg }}
        />
      )}
      {children}
    </span>
  );
}

export { StatusBadge, TONE_STYLES };
export type { StatusBadgeProps, StatusTone };
