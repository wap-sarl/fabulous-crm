import { Link } from 'react-router-dom';
import type { DuplicateLeadSummary } from '@crm/lib/backend';
import { dateFormat } from '@crm/lib/format';

export function LeadSide({ lead }: { lead: DuplicateLeadSummary }) {
  return (
    <div className="min-w-0 flex-1">
      <Link
        to={`/leads/${lead._id}`}
        className="block truncate text-sm font-semibold text-ink hover:underline"
      >
        {lead.name}
      </Link>
      <p className="truncate text-xs text-soft">{lead.email ?? '—'}</p>
      <p className="truncate font-mono text-xs text-soft">{lead.phone ?? '—'}</p>
      <p className="truncate text-xs text-faint">
        {lead.city ? `${lead.city} · ` : ''}créé le {dateFormat.format(lead.createdAt)}
      </p>
    </div>
  );
}
