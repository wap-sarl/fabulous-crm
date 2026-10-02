import { Save, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import { NEW_MAPPING } from '../lib/mappingValues';
import type { ImportMappingRow } from '../types';

/** The saved mapping in use: pick one, name it, save it or delete it. */
export function SavedMappingBar({
  mappingId,
  applySavedMapping,
  mappings,
  mappingName,
  setMappingName,
  persistMapping,
  removeMapping,
}: {
  mappingId: string;
  applySavedMapping: (id: string) => void;
  mappings: ImportMappingRow[];
  mappingName: string;
  setMappingName: (value: string) => void;
  persistMapping: () => Promise<void>;
  removeMapping: () => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1 space-y-1.5">
        <Label>Correspondance enregistrée</Label>
        <Select value={mappingId} onValueChange={applySavedMapping}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_MAPPING}>Nouvelle correspondance</SelectItem>
            {mappings.map((m) => (
              <SelectItem key={m._id} value={m._id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-56 flex-1 space-y-1.5">
        <Label htmlFor="mapping-name">Nom (source : HubSpot, Excel comptable…)</Label>
        <Input
          id="mapping-name"
          value={mappingName}
          onChange={(e) => setMappingName(e.target.value)}
          placeholder="Export HubSpot"
        />
      </div>
      <Button variant="outline" onClick={persistMapping}>
        <Save className="h-4 w-4" />
        {mappingId === NEW_MAPPING ? 'Enregistrer' : 'Mettre à jour'}
      </Button>
      {mappingId !== NEW_MAPPING && (
        <Button variant="ghost" onClick={removeMapping} aria-label="Supprimer la correspondance">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
