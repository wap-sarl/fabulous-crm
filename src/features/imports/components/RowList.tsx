import { Button, Card } from '@crm/design-system';
import { api, type DuplicateReason, type Id, type ImportRowOutcome } from '@crm/lib/backend';
import { useAuthPaginatedQuery } from '@crm/widgets';
import { DUPLICATE_REASON_LABEL } from '../../leads/lib/duplicates';
import { describeImportError } from '../lib/errorLabels';
import { OUTCOME_LABEL } from '../lib/importStatus';

/** The rows of one outcome, a page at a time, with the source cells that matter. */
export function RowList({
  jobId,
  outcome,
  headers,
  title,
  action,
}: {
  jobId: Id<'importJobs'>;
  outcome: ImportRowOutcome;
  headers: string[];
  title: string;
  action?: React.ReactNode;
}) {
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.imports.queries.listJobRows,
    { jobId, outcome },
    { initialNumItems: 25 },
  );
  const shown = headers.slice(0, 4);
  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-soft">· {OUTCOME_LABEL[outcome]}</span>
        </h2>
        {action}
      </div>
      <ul className="divide-y divide-border text-xs">
        {results.map((row) => (
          <li key={row._id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
            <span className="w-16 shrink-0 text-faint">Ligne {row.line}</span>
            <span className="min-w-0 flex-1 truncate font-mono">
              {shown
                .map((h, c) => `${h.trim() || `col. ${c + 1}`}: ${row.raw[c] ?? ''}`)
                .join(' · ')}
            </span>
            {row.matchLabel ? (
              <span className="text-soft">
                → {row.matchLabel}
                {row.reasons.length
                  ? ` (${row.reasons.map((r) => DUPLICATE_REASON_LABEL[r as DuplicateReason] ?? r).join(', ')})`
                  : ''}
              </span>
            ) : null}
            {row.error ? (
              <span className="text-red-600">{describeImportError(row.error)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {status === 'CanLoadMore' && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => loadMore(25)}>
          Afficher plus
        </Button>
      )}
    </Card>
  );
}
