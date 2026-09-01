import { useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id, LeadAdvancedFilter } from '@crm/lib/backend';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  SortableList,
  Spinner,
  StatusBadge,
  Switch,
  toast,
} from '@crm/design-system';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { AdvancedFilterGroupsEditor } from '../../features/filters/components/AdvancedFilterBuilder';
import { countActiveRules, emptyAdvancedFilter } from '../../features/filters/lib/advancedFilter';
import { useLeadFieldCatalog } from '../../features/leads/hooks/useLeadFieldCatalog';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';

type ScoringRuleRow = {
  _id: Id<'scoringRules'>;
  name: string;
  description: string | undefined;
  criteria: LeadAdvancedFilter;
  points: number;
  active: boolean;
  decayHalfLifeDays: number | undefined;
};

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

function useScoringActions() {
  const createScoringRule = useAuthMutation(api.features.scoring.mutations.createScoringRule);
  const updateScoringRule = useAuthMutation(api.features.scoring.mutations.updateScoringRule);
  const deleteScoringRule = useAuthMutation(api.features.scoring.mutations.deleteScoringRule);
  const reorderScoringRules = useAuthMutation(api.features.scoring.mutations.reorderScoringRules);
  const recomputeScores = useAuthMutation(api.features.scoring.mutations.recomputeScores);
  const startScoreSimulation = useAuthMutation(api.features.scoring.mutations.startScoreSimulation);
  return {
    createScoringRule,
    updateScoringRule,
    deleteScoringRule,
    reorderScoringRules,
    recomputeScores,
    startScoreSimulation,
  };
}

const SAVE_ERRORS: Record<string, string> = {
  scoring_name_required: 'Le nom de la règle est requis.',
  invalid_scoring_points: 'Les points doivent être un entier non nul entre −100 et 100.',
  invalid_scoring_decay: 'La demi-vie doit être un nombre de jours entre 1 et 365.',
  scoring_criteria_required: 'Au moins un critère complet est requis.',
  scoring_criteria_forbidden_field:
    'Les critères ne peuvent pas porter sur les listes ni sur le score.',
};

function saveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const known = Object.keys(SAVE_ERRORS).find((code) => message.includes(code));
  return known ? SAVE_ERRORS[known] : 'Échec de l’enregistrement de la règle.';
}

/** Create/edit modal: name, points, decay and the lead criteria builder. */
function RuleDialog({ rule, onClose }: { rule: ScoringRuleRow | null; onClose: () => void }) {
  const { createScoringRule, updateScoringRule } = useScoringActions();
  const definitions = usePropertyDefinitions('lead');
  const fullCatalog = useLeadFieldCatalog(definitions);
  // Server rule: no list-membership and no score-on-score criteria.
  const catalog = {
    ...fullCatalog,
    standard: fullCatalog.standard.filter((f) => f.field !== 'listIds' && f.field !== 'leadScore'),
  };
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [points, setPoints] = useState(String(rule?.points ?? 10));
  const [decay, setDecay] = useState(rule?.decayHalfLifeDays ? String(rule.decayHalfLifeDays) : '');
  const [criteria, setCriteria] = useState<LeadAdvancedFilter>(
    () => rule?.criteria ?? emptyAdvancedFilter(catalog.standard),
  );
  const [busy, setBusy] = useState(false);
  const canSave =
    name.trim().length > 0 && points.trim().length > 0 && countActiveRules(criteria) > 0;

  const save = async () => {
    setBusy(true);
    try {
      const parsedPoints = Number(points);
      const parsedDecay = decay.trim() === '' ? undefined : Number(decay);
      if (rule) {
        await updateScoringRule({
          ruleId: rule._id,
          name: name.trim(),
          description: description.trim(),
          criteria,
          points: parsedPoints,
          decayHalfLifeDays: parsedDecay ?? null,
        });
        toast.success('Règle mise à jour — recalcul des scores lancé.');
      } else {
        await createScoringRule({
          name: name.trim(),
          description: description.trim() || undefined,
          criteria,
          points: parsedPoints,
          active: true,
          decayHalfLifeDays: parsedDecay,
        });
        toast.success('Règle créée — recalcul des scores lancé.');
      }
      onClose();
    } catch (error) {
      toast.error(saveErrorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {rule ? `Modifier « ${rule.name} »` : 'Nouvelle règle de score'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_120px_140px]">
            <div className="space-y-1.5">
              <Label>Nom</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. A ouvert un e-mail (7 j)"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Points</Label>
              <Input
                type="number"
                min={-100}
                max={100}
                step={1}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Demi-vie (jours)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                step={1}
                value={decay}
                onChange={(e) => setDecay(e.target.value)}
                placeholder="Aucune"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description (optionnelle)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Visible dans le détail du score"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Critères</Label>
            <p className="text-xs text-soft">
              Les leads correspondant aux critères gagnent (ou perdent) les points. La demi-vie
              divise les points par deux tous les N jours après la dernière interaction.
            </p>
            <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
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
            {rule ? 'Enregistrer' : 'Créer la règle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What-if card: « combien de leads seraient à N points ou plus ? » */
function SimulationCard() {
  const state = useAuthQuery(api.features.scoring.queries.getScoringState, {});
  const { startScoreSimulation } = useScoringActions();
  const [threshold, setThreshold] = useState('50');

  const sim = state?.simulation ?? null;
  const running = sim !== null && sim.finishedAt === undefined;

  const run = async () => {
    try {
      await startScoreSimulation({ threshold: Number(threshold) });
    } catch {
      toast.error('Seuil invalide (entier entre 0 et 100).');
    }
  };

  return (
    <Card className="mt-6 p-5">
      <h2 className="text-[15px] font-bold text-ink">Simulation</h2>
      <p className="mt-1 text-xs text-soft">
        Compte les leads dont le score atteindrait le seuil avec les règles actuelles (calcul en
        arrière-plan sur toute la base).
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Seuil</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-24"
          />
        </div>
        <Button variant="outline" onClick={run} loading={running}>
          Simuler
        </Button>
        {sim && (
          <p className="pb-2 text-sm text-body" role="status">
            {running
              ? `Calcul en cours… ${sim.processed} lead(s) analysés`
              : `${sim.matched} lead(s) à ${sim.threshold} points ou plus (${sim.processed} analysés).`}
          </p>
        )}
      </div>
    </Card>
  );
}

/** Scoring settings: ordered rule list, activation, simulation. */
export function ScoringPage() {
  usePageTitle('Scoring');
  const rules = useAuthQuery(api.features.scoring.queries.listScoringRules, {}) as
    | ScoringRuleRow[]
    | undefined;
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
      ? `Scores recalculés le ${DATETIME_FMT.format(state.lastRecalcAt)}`
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
