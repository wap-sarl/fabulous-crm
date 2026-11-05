import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useAuthMutation, useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { Button, Card, PageHeader, SegmentedControl, Skeleton } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { NotificationList } from '../../features/notifications/components/NotificationList';

const PAGE_SIZE = 30;
const SKELETON_ROWS = ['s1', 's2', 's3', 's4'];

/** The whole history, newest first, paginated, with the unread alone on request. */
export function NotificationsPage() {
  usePageTitle('Notifications');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const count = useAuthQuery(api.features.notifications.queries.unreadCount, {});
  const markAllRead = useAuthMutation(api.features.notifications.mutations.markAllRead);
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.notifications.queries.listMine,
    { unreadOnly: filter === 'unread' },
    { initialNumItems: PAGE_SIZE },
  );
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Notifications"
        subtitle={
          count === undefined
            ? undefined
            : count === 0
              ? 'Tout est lu'
              : `${count > 99 ? '99+' : count} non lue(s)`
        }
        loading={count === undefined}
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/settings/notifications">
                <Settings className="size-4" aria-hidden="true" />
                Préférences
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!count}
              onClick={() => void markAllRead({}).catch(() => undefined)}
            >
              Tout marquer comme lu
            </Button>
          </>
        }
      />
      <div className="mt-6 space-y-4">
        <SegmentedControl
          aria-label="Filtre"
          items={[
            { value: 'all', label: 'Toutes' },
            { value: 'unread', label: 'Non lues', count: count ?? null },
          ]}
          value={filter}
          onChange={(value) => setFilter(value as 'all' | 'unread')}
        />
        <Card className="p-2">
          {status === 'LoadingFirstPage' ? (
            <div className="space-y-2 p-2">
              {SKELETON_ROWS.map((key) => (
                <Skeleton key={key} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <NotificationList
              rows={results}
              emptyText={
                filter === 'unread' ? 'Aucune notification non lue.' : 'Aucune notification.'
              }
            />
          )}
        </Card>
        {status === 'CanLoadMore' && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => loadMore(PAGE_SIZE)}>
              Afficher plus
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
