import type * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../theme/utils';
import type { StatusTone } from './status-badge';

const TONE_ICON_STYLE: Record<StatusTone, string> = {
  blue: 'bg-info-soft text-info',
  amber: 'bg-warning-soft text-warning',
  violet: 'bg-violet-soft text-violet',
  green: 'bg-success-soft text-success',
  red: 'bg-destructive-soft text-destructive',
  gray: 'bg-muted text-soft',
};

interface NotificationItemProps extends Omit<React.ComponentProps<'button'>, 'title'> {
  icon: LucideIcon;
  tone: StatusTone;
  title: string;
  body: string;
  /** The relative time, already worded (« il y a 2 h »). */
  time: string;
  unread: boolean;
  /** Tighter rows for the popover; the page keeps the comfortable ones. */
  compact?: boolean;
}

/** One notification: its group's icon, the title, the body, when, and the dot while it is unread. A button: opening it marks it read. */
function NotificationItem({
  icon: Icon,
  tone,
  title,
  body,
  time,
  unread,
  compact = false,
  className,
  ...props
}: NotificationItemProps) {
  return (
    <button
      type="button"
      data-slot="notification-item"
      data-unread={unread ? '' : undefined}
      className={cn(
        'flex w-full cursor-pointer items-start gap-3 text-left transition-colors hover:bg-accent',
        compact ? 'rounded-lg px-2.5 py-2' : 'rounded-xl px-4 py-3',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'mt-0.5 flex shrink-0 items-center justify-center rounded-full',
          compact ? 'size-7 [&_svg]:size-3.5' : 'size-9 [&_svg]:size-4',
          TONE_ICON_STYLE[tone],
        )}
      >
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm',
              unread ? 'font-semibold text-ink' : 'font-medium text-body',
            )}
          >
            {title}
          </span>
          <span className="shrink-0 text-[11.5px] text-faint">{time}</span>
        </span>
        <span className={cn('block text-[13px] text-soft', compact ? 'truncate' : 'line-clamp-2')}>
          {body}
        </span>
      </span>
      <span
        aria-hidden
        data-slot="unread-dot"
        className={cn(
          'mt-2 size-2 shrink-0 rounded-full',
          unread ? 'bg-primary' : 'bg-transparent',
        )}
      />
    </button>
  );
}

export { NotificationItem };
