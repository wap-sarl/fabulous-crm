import {
  Combobox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { ImportEntity } from '@crm/lib/backend';
import type { LeadListRow } from '../../leadLists/types';
import { IMPORT_ENTITY_ORDER, IMPORT_SPECS } from '../lib/registry';
import type { ListMode, UploadProgress } from '../types';

/** What the file holds and, for leads, the list they join. */
export function ImportDestinationFields({
  entity,
  setEntity,
  upload,
  listMode,
  setListMode,
  lists,
  newListName,
  setNewListName,
  existingListId,
  setExistingListId,
}: {
  entity: ImportEntity;
  setEntity: (value: string) => void;
  upload: UploadProgress | null;
  listMode: ListMode;
  setListMode: (value: ListMode) => void;
  lists: LeadListRow[];
  newListName: string;
  setNewListName: (value: string) => void;
  existingListId: string;
  setExistingListId: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Quoi importer</Label>
        <Select value={entity} onValueChange={setEntity} disabled={upload !== null}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_ENTITY_ORDER.map((e) => (
              <SelectItem key={e} value={e}>
                {IMPORT_SPECS[e].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {entity === 'lead' && (
        <div className="space-y-1.5">
          <Label>Liste</Label>
          <Select value={listMode} onValueChange={(v) => setListMode(v as ListMode)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Nouvelle liste</SelectItem>
              <SelectItem value="existing" disabled={lists.length === 0}>
                Liste existante
              </SelectItem>
              <SelectItem value="none">Aucune liste</SelectItem>
            </SelectContent>
          </Select>
          {listMode === 'new' && (
            <Input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="Nom de la liste"
            />
          )}
          {listMode === 'existing' && (
            <Combobox
              items={lists.map((l) => ({ value: l._id, label: l.name }))}
              value={existingListId}
              onValueChange={setExistingListId}
              placeholder="Choisir une liste"
              searchPlaceholder="Rechercher une liste…"
              popoverWidth="w-full"
              className="w-full"
            />
          )}
        </div>
      )}
    </div>
  );
}
