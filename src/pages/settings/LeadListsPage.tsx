import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { Badge, Button, PageHeader, Spinner, toast } from '@crm/design-system';
import { ListChecks, Pencil, RefreshCw, Trash2, Upload, Zap } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useLeadActions } from '../../features/leads/hooks/useLeadActions';
import { countActiveRules } from '../../features/filters/lib/advancedFilter';
import type { LeadListRow } from '../../features/leadLists/types';
import { ListMembersDialog } from '../../features/leadLists/components/ListMembersDialog';
import { DynamicListDialog } from '../../features/leadLists/components/DynamicListDialog';
import { DeleteListDialog } from '../../features/leadLists/components/DeleteListDialog';

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

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
  const lists = useAuthQuery(api.features.leadLists.queries.listLeadLists, {}) as
    | LeadListRow[]
    | undefined;
  const navigate = useNavigate();
  const limits = useAuthQuery(api.features.leadLists.queries.getListLimits, {});
  const { recalcLeadList } = useLeadActions();
  const [members, setMembers] = useState<LeadListRow | null>(null);
  const [toDelete, setToDelete] = useState<LeadListRow | null>(null);
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
            <Button variant="outline" onClick={() => navigate('/import?entity=lead')}>
              <Upload className="size-4" aria-hidden="true" />
              Importer un fichier
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
    </div>
  );
}
