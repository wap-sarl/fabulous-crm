import { useState } from 'react';
import type { LeadAdvancedFilter } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  toast,
} from '@crm/design-system';
import { useLeadActions } from '../../leads/hooks/useLeadActions';
import { AdvancedFilterGroupsEditor } from '../../filters/components/AdvancedFilterGroupsEditor';
import { countActiveRules, emptyAdvancedFilter } from '../../filters/lib/advancedFilter';
import { useLeadFieldCatalog } from '../../leads/hooks/useLeadFieldCatalog';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import type { LeadListRow } from '../types';
import { errorText } from '@crm/lib/errors';

/** Create/edit modal for a dynamic list: name + the lead criteria builder. */
export function DynamicListDialog({
  list,
  onClose,
}: {
  list: LeadListRow | null;
  onClose: () => void;
}) {
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
      toast.error(
        errorText(error).includes('dynamic_list_cap_reached')
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
