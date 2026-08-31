import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id, LeadAdvancedFilter } from '@crm/lib/backend';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  PageHeader,
  Spinner,
  toast,
} from '@crm/design-system';
import { ListChecks, Pencil, RefreshCw, Trash2, Upload, Zap } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useLeadActions } from '../../features/leads/hooks/useLeadActions';
import { CsvImportDialog } from '../../features/leads/components/CsvImportDialog';
import { AdvancedFilterGroupsEditor } from '../../features/filters/components/AdvancedFilterBuilder';
import { countActiveRules, emptyAdvancedFilter } from '../../features/filters/lib/advancedFilter';
import { useLeadFieldCatalog } from '../../features/leads/hooks/useLeadFieldCatalog';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';

type LeadListRow = {
  _id: Id<'leadLists'>;
  name: string;
  kind: 'static' | 'dynamic';
  criteria: LeadAdvancedFilter | null;
  lastRecalcAt: number | null;
  recalcProcessed: number | null;
  memberCount: number;
  createdByName: string | null;
  createdAt: number;
};

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

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

/** Create/edit modal for a dynamic list: name + the lead criteria builder. */
function DynamicListDialog({ list, onClose }: { list: LeadListRow | null; onClose: () => void }) {
  const { createLeadList, updateLeadList } = useLeadActions();
  const definitions = usePropertyDefinitions('lead');
  const fullCatalog = useLeadFieldCatalog(definitions);
  // Criteria can't reference list membership (server rule) — hide the field.
  const catalog = {
    ...fullCatalog,
    standard: fullCatalog.standard.filter((f) => f.field !== 'listIds'),
  };
  const [name, setName] = useState(list?.name ?? '');
  const [criteria, setCriteria] = useState<LeadAdvancedFilter>(
    () => list?.criteria ?? emptyAdvancedFilter(catalog.standard),
  );
  const [busy, setBusy] = useState(false);
  const canSave = name.trim().length > 0 && countActiveRules(criteria) > 0;

  const save = async () => {
    setBusy(true);
    try {
      if (list) {
        await updateLeadList({ listId: list._id, name: name.trim(), criteria });
        toast.success('Liste mise à jour — recalcul lancé.');
      } else {
        await createLeadList({ name: name.trim(), kind: 'dynamic', criteria });
        toast.success('Liste dynamique créée — remplissage en cours.');
      }
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.error(
        message.includes('dynamic_list_cap_reached')
          ? 'Nombre maximum de listes dynamiques atteint.'
          : 'Échec de l’enregistrement de la liste.',
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {list ? `Modifier « ${list.name} »` : 'Nouvelle liste dynamique'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nom</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. MQL santé actifs 30 j"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Critères</Label>
            <p className="text-xs text-soft">
              La liste se remplit et se met à jour automatiquement : un lead y entre dès qu’il
              correspond aux critères, et en sort dès qu’il n’y correspond plus.
            </p>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
              <AdvancedFilterGroupsEditor
                value={criteria}
                onChange={setCriteria}
                catalog={catalog}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!canSave} onClick={save}>
            {list ? 'Enregistrer' : 'Créer la liste'}
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

/** One list row's subtitle: members, origin, and for dynamic lists the recalc state. */
function listSubtitle(list: LeadListRow): string {
  if (list.kind === 'dynamic') {
    const rules = countActiveRules(list.criteria ?? undefined);
    const state =
      list.recalcProcessed !== null
        ? `recalcul en cours (${list.recalcProcessed} traités)`
        : list.lastRecalcAt
          ? `recalculée le ${DATETIME_FMT.format(list.lastRecalcAt)}`
          : 'en attente de recalcul';
    return `${list.memberCount} lead(s) · ${rules} règle(s) · ${state}`;
  }
  return `${list.memberCount} lead(s) · importée par ${list.createdByName ?? '—'} · ${DATE_FMT.format(list.createdAt)}`;
}

/** Lists management: static (CSV imports) and dynamic (criteria-driven) lists. */
export function LeadListsPage() {
  usePageTitle('Listes');
  const lists = useAuthQuery(api.features.crm.queries.listLeadLists, {}) as
    | LeadListRow[]
    | undefined;
  const limits = useAuthQuery(api.features.crm.queries.getListLimits, {});
  const { recalcLeadList } = useLeadActions();
  const [members, setMembers] = useState<LeadListRow | null>(null);
  const [toDelete, setToDelete] = useState<LeadListRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toEdit, setToEdit] = useState<LeadListRow | null>(null);

  const capReached = limits !== undefined && limits.dynamicCount >= limits.maxDynamicLists;

  const recalc = async (list: LeadListRow) => {
    try {
      await recalcLeadList({ listId: list._id });
      toast.success('Recalcul lancé.');
    } catch {
      toast.error('Échec du lancement du recalcul.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Listes"
        subtitle="Listes statiques (imports CSV) et listes dynamiques pilotées par des critères"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden="true" />
              Importer un CSV
            </Button>
            <Button
              onClick={() => setEditorOpen(true)}
              disabled={capReached}
              title={
                capReached
                  ? `Maximum de ${limits?.maxDynamicLists} listes dynamiques atteint`
                  : undefined
              }
            >
              <Zap className="size-4" aria-hidden="true" />
              Liste dynamique
            </Button>
          </div>
        }
      />
      <div className="mt-6">
        {lists === undefined ? (
          <Spinner size="sm" />
        ) : lists.length === 0 ? (
          <p className="text-sm text-soft">
            Aucune liste pour le moment. Importez des leads (CSV) ou créez une liste dynamique.
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
                  {list.kind === 'dynamic' ? (
                    <Zap className="size-4 shrink-0 text-soft" aria-hidden="true" />
                  ) : (
                    <ListChecks className="size-4 shrink-0 text-soft" aria-hidden="true" />
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink hover:underline">
                        {list.name}
                      </span>
                      {list.kind === 'dynamic' && <Badge variant="secondary">dynamique</Badge>}
                    </span>
                    <span className="truncate text-xs text-soft">{listSubtitle(list)}</span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {list.kind === 'dynamic' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => recalc(list)}
                        disabled={list.recalcProcessed !== null}
                        aria-label={`Recalculer la liste ${list.name}`}
                        title="Recalculer"
                      >
                        <RefreshCw
                          className={`size-4 ${list.recalcProcessed !== null ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setToEdit(list)}
                        aria-label={`Modifier la liste ${list.name}`}
                        title="Modifier"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setToDelete(list)}
                    aria-label={`Supprimer la liste ${list.name}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {members && <ListMembersDialog list={members} onClose={() => setMembers(null)} />}
      {toDelete && <DeleteListDialog list={toDelete} onDone={() => setToDelete(null)} />}
      {(editorOpen || toEdit) && (
        <DynamicListDialog
          list={toEdit}
          onClose={() => {
            setEditorOpen(false);
            setToEdit(null);
          }}
        />
      )}
      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
