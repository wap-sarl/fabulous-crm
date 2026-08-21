import type * as React from 'react';
import { cn } from '../../theme/utils';

interface KeyValueRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  /** Render the value in mono (dates, counts, ids). */
  mono?: boolean;
}

/**
 * Label/value row — label muted on the left, value right-aligned.
 * Rows are separated by a light divider; the last row has none.
 */
function KeyValueRow({ label, mono, className, children, ...props }: KeyValueRowProps) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 border-b border-[#F3F4F6] py-2.5 last:border-b-0',
        className,
      )}
      {...props}
    >
      <span className="shrink-0 text-[12.5px] text-faint">{label}</span>
      <span
        className={cn(
          'min-w-0 text-right text-[13px] font-medium text-body',
          mono && 'font-mono text-[12.5px]',
        )}
      >
        {children}
      </span>
    </div>
  );
}

function KeyValueList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col', className)} {...props} />;
}

export { KeyValueList, KeyValueRow };
export type { KeyValueRowProps };
