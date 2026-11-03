import type * as React from 'react';
import { Bell } from 'lucide-react';
import { cn } from '../../theme/utils';
import { IconButton } from '../inputs/icon-button';

/** Past this the badge reads « 99+ »: the count behind it is read up to a cap, never counted in full. */
const SHOWN_MAX = 99;

export const bellBadgeText = (count: number): string =>
  count > SHOWN_MAX ? `${SHOWN_MAX}+` : String(count);

type NotificationBellProps = Omit<
  React.ComponentProps<typeof IconButton>,
  'aria-label' | 'children'
> & {
  /** Unread notifications; `undefined` while loading, `0` shows no badge. */
  count: number | undefined;
};

/** The bell of the shell: a fixed-size button whose badge sits over its corner, so the count landing moves nothing around it. */
function NotificationBell({ count, className, ...props }: NotificationBellProps) {
  const shown = count !== undefined && count > 0;
  const label =
    count === undefined
      ? 'Notifications'
      : count === 0
        ? 'Notifications, aucune non lue'
        : `Notifications, ${bellBadgeText(count)} non lue(s)`;
  return (
    <IconButton
      aria-label={label}
      className={cn('relative', className)}
      data-slot="notification-bell"
      {...props}
    >
      <Bell className="size-[18px]" />
      {shown && (
        <span
          data-slot="notification-badge"
          className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10.5px] font-bold leading-none text-primary-foreground tabular-nums"
        >
          {bellBadgeText(count)}
        </span>
      )}
    </IconButton>
  );
}

export { NotificationBell };
