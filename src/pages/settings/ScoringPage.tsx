import { useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PageHeader,
  SortableList,
  Spinner,
  StatusBadge,
  Switch,
  toast,
} from '@crm/design-system';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { countActiveRules } from '../../features/filters/lib/advancedFilter';
import { useScoringActions } from '../../features/scoring/hooks/useScoringActions';
import type { ScoringRuleRow } from '../../features/scoring/types';
import { RuleDialog } from '../../features/scoring/components/RuleDialog';
import { SimulationCard } from '../../features/scoring/components/SimulationCard';
import { dateTimeFormat } from '@crm/lib/format';

/** Scoring settings: ordered rule list, activation, simulation. */
export function ScoringPage() {
  usePageTitle('Scoring');
  const rules = useAuthQuery(api.features.scoring.queries.listScoringRules, {});
  const state = useAuthQuery(api.features.scoring.queries.getScoringState, {});
  const { updateScoringRule, deleteScoringRule, reorderScoringRules, recomputeScores } =
    useScoringActions();
  const [editorOpen, setEditorOpen] = useState(false);
  const [toEdit, setToEdit] = useState<ScoringRuleRow | null>(null);
  const [toDelete, setToDelete] = useState<ScoringRuleRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const recomputing = state !== undefined && state.recalcProcessed !== null;

  const toggleActive = async (rule: ScoringRuleRow) => {
    try {
      await updateScoringRule({ ruleId: rule._id, active: !rule.active });
    } catch {
      toast.error('Échec de la mise à jour de la règle.');
    }
  };

  const reorder = async (ordered: ScoringRuleRow[]) => {
    try {
      await reorderScoringRules({ ruleIds: ordered.map((r) => r._id) });
    } catch {
      toast.error('Échec du réordonnancement.');
    }
  };

  const recompute = async () => {
    try {
      await recomputeScores({});
      toast.success('Recalcul des scores lancé.');
    } catch {
      toast.error('Échec du lancement du recalcul.');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteScoringRule({ ruleId: toDelete._id });
      toast.success('Règle supprimée — recalcul des scores lancé.');
      setToDelete(null);
    } catch {
      toast.error('Échec de la suppression.');
    } finally {
      setDeleting(false);
    }
  };

  const recomputeSubtitle = recomputing
    ? `Recalcul en cours (${state?.recalcProcessed} traités)…`
    : state?.lastRecalcAt
      ? `Scores recalculés le ${dateTimeFormat.format(state.lastRecalcAt)}`
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Scoring"
        subtitle="Des règles à points (positifs ou négatifs) construisent le score 0–100 de chaque lead"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={recompute}
              disabled={recomputing}
              title="Recalculer tous les scores"
            >
              <RefreshCw
                className={`size-4 ${recomputing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Recalculer
            </Button>
            <Button onClick={() => setEditorOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Nouvelle règle
            </Button>
          </div>
        }
      />
      {recomputeSubtitle && <p className="mt-2 text-xs text-soft">{recomputeSubtitle}</p>}
      <div className="mt-6">
        {rules === undefined ? (
          <Spinner size="sm" />
        ) : rules.length === 0 ? (
          <p className="text-sm text-soft">
            Aucune règle de score. Créez-en une pour commencer à scorer vos leads.
          </p>
        ) : (
          <SortableList
            items={rules}
            getId={(r) => r._id}
            onReorder={reorder}
            className="divide-y divide-border rounded-lg border border-border"
            renderItem={(rule, _index, handle) => (
              <div className="flex items-center gap-2 px-3 py-3">
                {handle}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{rule.name}</span>
                    <StatusBadge tone={rule.points >= 0 ? 'green' : 'red'} withDot={false}>
                      {rule.points >= 0 ? '+' : ''}
                      {rule.points}
                    </StatusBadge>
                  </span>
                  <span className="truncate text-xs text-soft">
                    {countActiveRules(rule.criteria)} critère(s)
                    {rule.decayHalfLifeDays ? ` · demi-vie ${rule.decayHalfLifeDays} j` : ''}
                    {rule.description ? ` · ${rule.description}` : ''}
                  </span>
                </span>
                <Switch
                  checked={rule.active}
                  onCheckedChange={() => toggleActive(rule)}
                  aria-label={`Activer la règle ${rule.name}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setToEdit(rule)}
                  aria-label={`Modifier la règle ${rule.name}`}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setToDelete(rule)}
                  aria-label={`Supprimer la règle ${rule.name}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            )}
          />
        )}
      </div>

      <SimulationCard />

      {(editorOpen || toEdit) && (
        <RuleDialog
          rule={toEdit}
          onClose={() => {
            setEditorOpen(false);
            setToEdit(null);
          }}
        />
      )}
      {toDelete && (
        <Dialog open onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Supprimer « {toDelete.name} » ?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-soft">
              Les scores seront recalculés sans cette règle sur toute la base.
            </p>
            <DialogFooter>
              <Button variant="ghost" disabled={deleting} onClick={() => setToDelete(null)}>
                Annuler
              </Button>
              <Button variant="fill" color="destructive" loading={deleting} onClick={confirmDelete}>
                Supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
