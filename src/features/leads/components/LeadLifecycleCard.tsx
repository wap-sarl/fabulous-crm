import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id, LifecycleChangeSource } from '@crm/lib/backend';
import { Card, Spinner } from '@crm/design-system';
import { ArrowRight } from 'lucide-react';
import { useLifecycleConfig } from '../hooks/useLifecycleConfig';

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const SOURCE_LABEL: Record<LifecycleChangeSource, string> = {
  manual: 'Manuel',
  import: 'Import CSV',
  workflow: 'Workflow',
  migration: 'Migration',
  deal: 'Transaction gagnée',
};

/** Human-readable duration between two transitions ("3 j", "5 h", "12 min"). */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

interface LeadLifecycleCardProps {
  leadId: Id<'leads'>;
  currentStage: string | undefined;
}

export function LeadLifecycleCard({ leadId, currentStage }: LeadLifecycleCardProps) {
  const lifecycle = useLifecycleConfig();
  const history = useAuthQuery(api.features.crm.queries.listLifecycleHistory, { leadId });
  const currentIndex = lifecycle.indexOf(currentStage);

  return (
    <Card className="p-5" data-testid="lead-lifecycle-card">
      <h2 className="mb-3 text-[15px] font-bold text-ink">Cycle de vie</h2>

      <ol className="mb-4 flex flex-wrap gap-1" aria-label="Étapes du cycle de vie">
        {lifecycle.stages.map((stage, index) => {
          const reached = currentIndex >= 0 && index <= currentIndex;
          const current = index === currentIndex;
          return (
            <li
              key={stage.key}
              className={
                current
                  ? 'rounded-md bg-primary px-2 py-1 text-xs font-semibold text-white'
                  : reached
                    ? 'rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary'
                    : 'rounded-md bg-[#F2F3F5] px-2 py-1 text-xs font-medium text-faint'
              }
              aria-current={current ? 'step' : undefined}
            >
              {stage.label}
            </li>
          );
        })}
      </ol>

      {history === undefined ? (
        <Spinner size="sm" />
      ) : history.length === 0 ? (
        <p className="text-sm text-faint">Aucun historique.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {[...history].reverse().map((row, i, rows) => {
            // Rows are newest-first here; the time in `row.to` runs until the
            // next transition (previous element), or until now for the latest.
            const until = i === 0 ? Date.now() : rows[i - 1].changedAt;
            const actor =
              row.source === 'workflow'
                ? (row.workflowName ?? 'Workflow')
                : (row.changedByName ?? SOURCE_LABEL[row.source]);
            return (
              <li key={row._id} className="flex flex-col gap-0.5 py-2 text-sm">
                <span className="flex items-center gap-1.5 font-medium text-ink">
                  {row.from ? (
                    <>
                      <span className="text-faint">{lifecycle.labelOf(row.from)}</span>
                      <ArrowRight className="size-3.5 text-faint" aria-hidden />
                    </>
                  ) : null}
                  <span>{lifecycle.labelOf(row.to)}</span>
                  <span className="ml-auto text-xs font-normal text-faint">
                    {formatDuration(until - row.changedAt)}
                  </span>
                </span>
                <span className="text-xs text-faint">
                  {dateTimeFormat.format(row.changedAt)} · {actor}
                  {row.source !== 'workflow' && row.changedByName
                    ? ` (${SOURCE_LABEL[row.source].toLowerCase()})`
                    : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
