import { useState } from 'react';
import type { LeadAdvancedFilter } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@crm/design-system';
import { AdvancedFilterGroupsEditor } from '../../filters/components/AdvancedFilterBuilder';
import { countActiveRules, emptyAdvancedFilter } from '../../filters/lib/advancedFilter';
import { useLeadFieldCatalog } from '../../leads/hooks/useLeadFieldCatalog';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { useScoringActions } from '../hooks/useScoringActions';
import type { ScoringRuleRow } from '../types';

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
export function RuleDialog({
  rule,
  onClose,
}: {
  rule: ScoringRuleRow | null;
  onClose: () => void;
}) {
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
