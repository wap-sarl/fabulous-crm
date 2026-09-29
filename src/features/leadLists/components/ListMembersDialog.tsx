import { Link } from 'react-router-dom';
import { useAuthPaginatedQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Spinner,
} from '@crm/design-system';
import type { LeadListRow } from '../types';

/** Modal listing the leads that belong to a list. */
export function ListMembersDialog({ list, onClose }: { list: LeadListRow; onClose: () => void }) {
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.leads.queries.listLeadsPaginated,
    { listIds: [list._id], sortField: 'recent', sortDirection: 'desc' },
    { initialNumItems: 50 },
  );
  const isLoading = status === 'LoadingFirstPage';
  const hasMore = status === 'CanLoadMore';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {list.name} — {list.memberCount} lead(s)
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <Spinner size="sm" />
          ) : results.length === 0 ? (
            <p className="text-sm text-soft">Aucun lead dans cette liste.</p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((lead) => (
                <li key={lead._id} className="flex flex-col px-1 py-2">
                  <Link
                    to={`/leads/${lead._id}`}
                    className="truncate text-sm font-medium text-ink hover:underline"
                  >
                    {lead.firstName} {lead.lastName}
                  </Link>
                  <span className="truncate text-xs text-soft">
                    {lead.email ?? lead.phone ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => loadMore(50)}>
              Charger plus
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
