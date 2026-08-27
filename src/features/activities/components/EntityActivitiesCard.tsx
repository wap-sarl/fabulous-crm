import { useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { ActivityRow } from '@crm/lib/backend';
import { Button, Card, Spinner, cn, toast } from '@crm/design-system';
import { Check, Phone, Plus, RotateCcw } from 'lucide-react';
import { ACTIVITY_TYPE_LABEL } from '../../../lib/constants';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { formatPropertyValue, hasPropertyValue } from '../../properties/lib/customProperties';
import { activityErrorMessage, useActivityActions } from '../hooks/useActivityActions';
import { ACTIVITY_ICON } from '../lib/constants';
import {
  ActivityFormDialog,
  CompleteActivityDialog,
  LogCallDialog,
  type ActivityLinks,
} from './ActivityDialogs';

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** One activity line: icon, title, due/completed date, outcome, complete/reopen. */
export function ActivityListItem({
  activity,
  onComplete,
  onReopen,
  showLinks,
}: {
  activity: ActivityRow;
  onComplete: (activity: ActivityRow) => void;
  onReopen: (activity: ActivityRow) => void;
  showLinks?: boolean;
}) {
  const Icon = ACTIVITY_ICON[activity.type];
  const definitions = usePropertyDefinitions('activity');
  const customLine = definitions
    .filter((def) => hasPropertyValue(activity.customProperties?.[def._id]))
    .map(
      (def) => `${def.label} : ${formatPropertyValue(def, activity.customProperties?.[def._id])}`,
    )
    .join(' · ');
  const overdue =
    activity.status === 'open' && activity.dueAt !== undefined && activity.dueAt < Date.now();
  const links = showLinks
    ? [activity.leadName, activity.companyName, activity.dealTitle].filter(Boolean).join(' · ')
    : '';
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid="activity-item">
      <button
        type="button"
        aria-label={activity.status === 'open' ? 'Terminer' : 'Rouvrir'}
        onClick={() => (activity.status === 'open' ? onComplete(activity) : onReopen(activity))}
        className={cn(
          'mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors',
          activity.status === 'done'
            ? 'border-green-600 bg-green-600 text-white'
            : 'border-[#C8CCD4] text-transparent hover:border-primary hover:text-primary',
        )}
        data-testid="activity-toggle"
      >
        {activity.status === 'done' ? (
          <Check className="size-3.5" />
        ) : activity.status === 'cancelled' ? (
          <RotateCcw className="size-3 text-faint" />
        ) : (
          <Check className="size-3.5" />
        )}
      </button>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[#F2F3F5] text-soft"
        title={ACTIVITY_TYPE_LABEL[activity.type]}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[13px] font-semibold text-ink',
            activity.status !== 'open' && 'text-faint line-through',
          )}
        >
          {activity.title}
        </span>
        <span className={cn('block truncate text-xs', overdue ? 'text-destructive' : 'text-faint')}>
          {activity.status === 'done' && activity.completedAt
            ? `Terminée le ${dateTimeFormat.format(activity.completedAt)}`
            : activity.dueAt !== undefined
              ? `${overdue ? 'En retard — ' : ''}${dateTimeFormat.format(activity.dueAt)}`
              : 'Sans date'}
          {activity.ownerName ? ` · ${activity.ownerName}` : ''}
          {links ? ` · ${links}` : ''}
        </span>
        {activity.outcome ? (
          <span className="block truncate text-xs text-soft">↳ {activity.outcome}</span>
        ) : null}
        {activity.description ? (
          <span className="block truncate text-xs text-faint">{activity.description}</span>
        ) : null}
        {customLine ? (
          <span className="block truncate text-xs text-faint">{customLine}</span>
        ) : null}
      </span>
    </li>
  );
}

interface EntityActivitiesCardProps extends ActivityLinks {
  /** Show the "log a call" shortcut (leads and companies). */
  canLogCall?: boolean;
}

/** "Activités" card of a lead / company / transaction page. */
export function EntityActivitiesCard({
  leadId,
  companyId,
  dealId,
  canLogCall = true,
}: EntityActivitiesCardProps) {
  const links: ActivityLinks = { leadId, companyId, dealId };
  const activities = useAuthQuery(
    api.features.activities.queries.listActivitiesForEntity,
    leadId ? { leadId } : companyId ? { companyId } : { dealId },
  );
  const { reopenActivity } = useActivityActions();
  const [formOpen, setFormOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [completing, setCompleting] = useState<ActivityRow | null>(null);

  const reopen = async (activity: ActivityRow) => {
    try {
      await reopenActivity({ activityId: activity._id });
    } catch (e) {
      toast.error(activityErrorMessage(e, 'Échec.'));
    }
  };

  return (
    <Card className="p-5" data-testid="entity-activities-card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-ink">Activités</h2>
        <div className="flex gap-1">
          {canLogCall ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCallOpen(true)}
              data-testid="log-call"
            >
              <Phone className="size-4" />
              Consigner un appel
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFormOpen(true)}
            data-testid="new-activity"
          >
            <Plus className="size-4" />
            Nouvelle tâche
          </Button>
        </div>
      </div>
      {activities === undefined ? (
        <Spinner size="sm" />
      ) : activities.length === 0 ? (
        <p className="text-sm text-faint">Aucune activité.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {activities.map((activity) => (
            <ActivityListItem
              key={activity._id}
              activity={activity}
              onComplete={setCompleting}
              onReopen={reopen}
            />
          ))}
        </ul>
      )}
      <ActivityFormDialog open={formOpen} onOpenChange={setFormOpen} links={links} />
      <LogCallDialog open={callOpen} onOpenChange={setCallOpen} links={links} />
      <CompleteActivityDialog activity={completing} onClose={() => setCompleting(null)} />
    </Card>
  );
}
