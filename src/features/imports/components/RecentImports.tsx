import type { NavigateFunction } from 'react-router-dom';
import { Badge, Card, StatusBadge } from '@crm/design-system';
import { dateTimeFormat, numberFormat } from '@crm/lib/format';
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from '../lib/importStatus';
import { IMPORT_SPECS } from '../lib/registry';
import type { ImportJobRow } from '../types';

/** The latest imports, each a link to its job page. */
export function RecentImports({
  jobs,
  navigate,
}: {
  jobs: ImportJobRow[];
  navigate: NavigateFunction;
}) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Imports récents</h2>
      <ul className="divide-y divide-border">
        {jobs.map((job) => (
          <li key={job._id}>
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm hover:bg-muted/40"
              onClick={() => navigate(`/import/${job._id}`)}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{job.fileName}</span>
                <span className="text-soft">
                  {' '}
                  · {IMPORT_SPECS[job.entity].label} · {numberFormat.format(job.totalRows)} ligne(s)
                </span>
              </span>
              <StatusBadge tone={JOB_STATUS_TONE[job.status]}>
                {JOB_STATUS_LABEL[job.status]}
              </StatusBadge>
              <Badge variant="secondary">{dateTimeFormat.format(job._creationTime)}</Badge>
              {job.createdByName ? (
                <span className="text-xs text-faint">{job.createdByName}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
