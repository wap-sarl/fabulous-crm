import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  PageHeader,
  Spinner,
  toast,
} from '@crm/design-system';
import { ListChecks, Trash2, Upload } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useLeadActions } from '../../features/leads/hooks/useLeadActions';
import { CsvImportDialog } from '../../features/leads/components/CsvImportDialog';

type LeadListRow = {
  _id: Id<'leadLists'>;
  name: string;
  memberCount: number;
  createdByName: string | null;
  createdAt: number;
};

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

/** Modal listing the leads that belong to a list. */
function ListMembersDialog({ list, onClose }: { list: LeadListRow; onClose: () => void }) {
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.crm.queries.listLeadsPaginated,
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

/** Confirmation modal offering "list only" vs "list + leads" deletion. */
function DeleteListDialog({ list, onDone }: { list: LeadListRow; onDone: () => void }) {
  const { deleteLeadList } = useLeadActions();
  const [busy, setBusy] = useState(false);

  const run = async (deleteLeads: boolean) => {
    setBusy(true);
    try {
      // The mutation deletes members in bounded batches; loop until it's done.
      let done = false;
      while (!done) {
        const res = await deleteLeadList({ listId: list._id, deleteLeads });
        done = res.done;
      }
      toast.success(deleteLeads ? 'Liste et leads supprimés.' : 'Liste supprimée.');
      onDone();
    } catch {
      toast.error('Échec de la suppression.');
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer « {list.name} » ?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-soft">
          Cette liste contient {list.memberCount} lead(s). Voulez-vous aussi supprimer ces leads, ou
          seulement la liste (les leads restent dans le CRM) ?
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button variant="fill" color="destructive" loading={busy} onClick={() => run(true)}>
            Supprimer la liste et ses leads
          </Button>
          <Button variant="outline" loading={busy} onClick={() => run(false)}>
            Supprimer la liste seule
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onDone}>
            Annuler
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lists management: view members, see who imported each list, delete lists. */
export function LeadListsPage() {
  usePageTitle('Listes');
  const lists = useAuthQuery(api.features.crm.queries.listLeadLists, {}) as
    | LeadListRow[]
    | undefined;
  const [members, setMembers] = useState<LeadListRow | null>(null);
  const [toDelete, setToDelete] = useState<LeadListRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Listes"
        subtitle="Listes de leads issues des imports CSV"
        actions={
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="size-4" aria-hidden="true" />
            Importer un CSV
          </Button>
        }
      />
      <div className="mt-6">
        {lists === undefined ? (
          <Spinner size="sm" />
        ) : lists.length === 0 ? (
          <p className="text-sm text-soft">
            Aucune liste pour le moment. Importez des leads (CSV) pour en créer une.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lists.map((list) => (
              <li key={list._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setMembers(list)}
                  className="flex min-w-0 items-center gap-3 text-left"
                >
                  <ListChecks className="size-4 shrink-0 text-soft" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-ink hover:underline">
                      {list.name}
                    </span>
                    <span className="truncate text-xs text-soft">
                      {list.memberCount} lead(s) · importée par {list.createdByName ?? '—'} ·{' '}
                      {DATE_FMT.format(list.createdAt)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setToDelete(list)}
                  aria-label={`Supprimer la liste ${list.name}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {members && <ListMembersDialog list={members} onClose={() => setMembers(null)} />}
      {toDelete && <DeleteListDialog list={toDelete} onDone={() => setToDelete(null)} />}
      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
