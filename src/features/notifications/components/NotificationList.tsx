import { useNavigate } from 'react-router-dom';
import { useAuthMutation } from '@crm/widgets';
import { api, type Doc } from '@crm/lib/backend';
import { NotificationItem } from '@crm/design-system';
import { formatRelativeTime } from '@crm/lib/format';
import { presentationOf } from '../lib/presentation';

export type NotificationRow = Doc<'notifications'>;

interface NotificationListProps {
  rows: NotificationRow[];
  compact?: boolean;
  /** After a row opened its record: the popover closes. */
  onOpened?: () => void;
  emptyText: string;
}

/** The rows of the inbox; opening one marks it read and goes to its record. */
export function NotificationList({ rows, compact, onOpened, emptyText }: NotificationListProps) {
  const navigate = useNavigate();
  const markRead = useAuthMutation(api.features.notifications.mutations.markRead);
  const now = Date.now();
  if (rows.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-faint">{emptyText}</p>;
  }
  const open = (row: NotificationRow) => {
    // The read mark is not awaited: the page opens at once, the dot follows.
    if (row.readAt === undefined) void markRead({ notificationId: row._id }).catch(() => undefined);
    navigate(row.path);
    onOpened?.();
  };
  return (
    <ul className={compact ? 'space-y-0.5' : 'space-y-1'}>
      {rows.map((row) => {
        const { icon, tone } = presentationOf(row.kind);
        return (
          <li key={row._id}>
            <NotificationItem
              icon={icon}
              tone={tone}
              title={row.title}
              body={row.body}
              time={formatRelativeTime(row.createdAt, now)}
              unread={row.readAt === undefined}
              compact={compact}
              onClick={() => open(row)}
            />
          </li>
        );
      })}
    </ul>
  );
}
