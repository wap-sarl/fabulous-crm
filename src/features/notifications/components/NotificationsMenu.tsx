import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import {
  Button,
  NotificationBell,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from '@crm/design-system';
import { NotificationList } from './NotificationList';

/** The bell of the shell and its popover: the latest twenty, « Tout marquer comme lu », the way to the page. Live queries: the badge follows without polling. */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const count = useAuthQuery(api.features.notifications.queries.unreadCount, {});
  // The list is subscribed only while the popover is open.
  const latest = useAuthQuery(api.features.notifications.queries.latest, open ? {} : 'skip');
  const markAllRead = useAuthMutation(api.features.notifications.mutations.markAllRead);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <NotificationBell count={count} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-2rem)] p-2">
        <div className="flex items-center justify-between px-2.5 pt-1 pb-2">
          <span className="text-sm font-semibold text-ink">Notifications</span>
          <Button
            variant="ghost"
            size="xs"
            disabled={!count}
            onClick={() => void markAllRead({}).catch(() => undefined)}
          >
            Tout marquer comme lu
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {latest === undefined ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : (
            <NotificationList
              rows={latest}
              compact
              onOpened={() => setOpen(false)}
              emptyText="Rien de nouveau."
            />
          )}
        </div>
        <div className="border-t pt-2 text-center">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="text-[13px] font-medium text-primary hover:underline"
          >
            Tout voir
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
