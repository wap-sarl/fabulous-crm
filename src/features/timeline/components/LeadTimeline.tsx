import { useState } from 'react';
import { useAuthPaginatedQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { Button, Card, SegmentedControl, Skeleton, Spinner } from '@crm/design-system';
import { useLifecycleConfig } from '../../leads/hooks/useLifecycleConfig';
import { TIMELINE_FILTERS } from '../lib/constants';
import { groupByDay } from '../lib/groupByDay';
import { TimelineEventItem } from './TimelineEventItem';

const PAGE_SIZE = 25;
const SKELETON_ROWS = ['s1', 's2', 's3', 's4', 's5'];

/** « Historique » card of the lead page: every source merged, newest first. */
export function LeadTimeline({ leadId }: { leadId: Id<'leads'> }) {
  const [filter, setFilter] = useState('all');
  const kinds = TIMELINE_FILTERS.find((f) => f.value === filter)?.kinds ?? [];
  const lifecycle = useLifecycleConfig();
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.timeline.queries.listLeadTimeline,
    { leadId, kinds: kinds.length > 0 ? kinds : undefined },
    { initialNumItems: PAGE_SIZE },
  );
  const groups = groupByDay(results);

  return (
    <Card className="p-5" data-testid="lead-timeline">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-ink">Historique</h2>
        <SegmentedControl
          aria-label="Type d’événement"
          items={TIMELINE_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {status === 'LoadingFirstPage' ? (
        <div className="flex flex-col gap-2">
          {SKELETON_ROWS.map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <p className="text-sm text-faint">Aucun événement.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">
                {group.label}
              </h3>
              <ol className="flex flex-col divide-y divide-border">
                {group.events.map((event) => (
                  <TimelineEventItem
                    key={event.id}
                    event={event}
                    lifecycleLabel={lifecycle.labelOf}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {status === 'CanLoadMore' ? (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => loadMore(PAGE_SIZE)}>
            Charger plus
          </Button>
        </div>
      ) : status === 'LoadingMore' ? (
        <div className="mt-3 flex justify-center">
          <Spinner size="sm" />
        </div>
      ) : null}
    </Card>
  );
}
