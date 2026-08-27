import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth, useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { ActivityRow, Id } from '@crm/lib/backend';
import {
  Button,
  PageHeader,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@crm/design-system';
import { Plus } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useEmployees } from '../../lib/hooks/useEmployees';
import { useTeams } from '../../lib/hooks/useTeams';
import {
  ActivityFormDialog,
  CompleteActivityDialog,
} from '../../features/activities/components/ActivityDialogs';
import { ActivityListItem } from '../../features/activities/components/EntityActivitiesCard';
import {
  activityErrorMessage,
  useActivityActions,
} from '../../features/activities/hooks/useActivityActions';
import {
  TASK_BUCKETS,
  bucketWindow,
  dayBounds,
  type TaskBucket,
} from '../../features/activities/lib/buckets';

const PAGE_SIZE = 30;
const ME = '__me__';
const SKELETON_ROWS = ['s1', 's2', 's3', 's4'];

export function TasksPage() {
  usePageTitle('Tâches');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const bucket = (TASK_BUCKETS.find((b) => b.value === searchParams.get('bucket'))?.value ??
    'today') as TaskBucket;
  const ownerParam = searchParams.get('owner') ?? '';
  const teamParam = searchParams.get('team') ?? '';
  const ownerId = ownerParam ? (ownerParam as Id<'users'>) : undefined;
  const teamId = teamParam ? (teamParam as Id<'teams'>) : undefined;
  const { employees } = useEmployees();
  const { teamsOf } = useTeams();
  const myTeams = teamsOf(user?._id);
  const { reopenActivity } = useActivityActions();
  const [formOpen, setFormOpen] = useState(false);
  const [completing, setCompleting] = useState<ActivityRow | null>(null);

  // Day boundaries in the browser's time zone, fixed for this render.
  const bounds = useMemo(() => dayBounds(), []);
  const window = bucketWindow(bucket, bounds);

  const counts = useAuthQuery(api.features.activities.queries.countTaskBuckets, {
    ownerId,
    teamId,
    ...bounds,
  });
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.activities.queries.listTasks,
    { ownerId, teamId, ...window },
    { initialNumItems: PAGE_SIZE },
  );

  const setParam = (key: string, value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const reopen = async (activity: ActivityRow) => {
    try {
      await reopenActivity({ activityId: activity._id });
    } catch (e) {
      toast.error(activityErrorMessage(e, 'Échec.'));
    }
  };

  const countOf = (b: TaskBucket) => (counts && b !== 'done' ? counts[b] : undefined);
  const ownerLabel = ownerId
    ? (employees.find((e) => e._id === ownerId)?.firstName ?? 'ce collaborateur')
    : 'moi';
  const teamLabel = teamId ? (myTeams.find((t) => t._id === teamId)?.name ?? 'mon équipe') : null;
  const scope = teamId ? `team:${teamId}` : ownerParam || ME;
  const setScope = (v: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('owner');
        next.delete('team');
        if (v.startsWith('team:')) next.set('team', v.slice(5));
        else if (v !== ME) next.set('owner', v);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title={
          teamLabel
            ? `Tâches de l’équipe ${teamLabel}`
            : ownerId && ownerId !== user?._id
              ? `Tâches de ${ownerLabel}`
              : 'Mes tâches'
        }
        subtitle={
          counts
            ? `${counts.overdue} en retard · ${counts.today} aujourd’hui · ${counts.week} cette semaine`
            : undefined
        }
        actions={
          <Button onClick={() => setFormOpen(true)} data-testid="new-task">
            <Plus className="h-4 w-4" />
            Nouvelle tâche
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-5 pb-6 sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            aria-label="Période"
            items={TASK_BUCKETS.map((b) => ({
              value: b.value,
              label: b.label,
              count: countOf(b.value),
            }))}
            value={bucket}
            onChange={(v) => setParam('bucket', v === 'today' ? '' : v)}
          />
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-56" aria-label="Périmètre">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ME}>Mes tâches</SelectItem>
              {myTeams.map((t) => (
                <SelectItem key={t._id} value={`team:${t._id}`}>
                  Équipe {t.name}
                </SelectItem>
              ))}
              {employees
                .filter((e) => e._id !== user?._id)
                .map((e) => (
                  <SelectItem key={e._id} value={e._id}>
                    {e.firstName} {e.lastName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border bg-card px-4 shadow-card">
          {status === 'LoadingFirstPage' ? (
            <div className="flex flex-col gap-2 py-3">
              {SKELETON_ROWS.map((row) => (
                <Skeleton key={row} className="h-10 w-full" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-faint">
              {bucket === 'overdue'
                ? 'Rien en retard.'
                : bucket === 'today'
                  ? 'Rien pour aujourd’hui.'
                  : 'Aucune activité.'}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {results.map((activity) => (
                <ActivityListItem
                  key={activity._id}
                  activity={activity}
                  onComplete={setCompleting}
                  onReopen={reopen}
                  showLinks
                />
              ))}
            </ul>
          )}
        </div>
        {status === 'CanLoadMore' && (
          <div className="flex justify-center">
            <Button variant="ghost" onClick={() => loadMore(PAGE_SIZE)}>
              Charger plus
            </Button>
          </div>
        )}
      </div>

      <ActivityFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <CompleteActivityDialog activity={completing} onClose={() => setCompleting(null)} />
    </div>
  );
}
