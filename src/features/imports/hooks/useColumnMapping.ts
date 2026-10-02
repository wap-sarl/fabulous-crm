import { useEffect, useRef, useState } from 'react';
import { toast } from '@crm/design-system';
import { api, type Id, type ImportEntity } from '@crm/lib/backend';
import { describeError } from '@crm/lib/errors';
import { useAuthMutation } from '@crm/widgets';
import type { PropertyDefinitionRow } from '../../properties/types';
import { autoDetectTarget, type ImportFieldDef } from '../lib/fields';
import { NEW_MAPPING } from '../lib/mappingValues';
import type { ImportMappingRow } from '../types';

/** The target of each column of the file: detected or taken from a saved mapping, which it saves and deletes. */
export function useColumnMapping({
  entity,
  header,
  fields,
  customDefs,
  mappings,
}: {
  entity: ImportEntity;
  header: string[];
  fields: readonly ImportFieldDef<unknown>[];
  customDefs: PropertyDefinitionRow[];
  mappings: ImportMappingRow[];
}) {
  const saveMapping = useAuthMutation(api.features.imports.mutations.saveMapping);
  const deleteMapping = useAuthMutation(api.features.imports.mutations.deleteMapping);

  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [mappingId, setMappingId] = useState<string>(NEW_MAPPING);
  const [mappingName, setMappingName] = useState('');

  // A saved mapping whose headers are the file's is applied by itself; else the headers are auto-detected.
  const initKeyRef = useRef('');
  useEffect(() => {
    const key = `${entity}::${customDefs.length}::${mappings.length}::${header.join('\u0000')}`;
    if (key === initKeyRef.current) return;
    initKeyRef.current = key;
    const normalized = header.map((h) => h.trim().toLowerCase());
    const saved = mappings.find(
      (m) =>
        m.headers.length === normalized.length &&
        m.headers.every((h, i) => h.trim().toLowerCase() === normalized[i]),
    );
    if (saved) {
      setMapping([...saved.targets]);
      setMappingId(saved._id);
      setMappingName(saved.name);
    } else {
      setMapping(header.map((h) => autoDetectTarget(h, fields, customDefs)));
      setMappingId(NEW_MAPPING);
      setMappingName('');
    }
  }, [entity, header, fields, customDefs, mappings]);

  const applySavedMapping = (id: string) => {
    setMappingId(id);
    if (id === NEW_MAPPING) {
      setMappingName('');
      return;
    }
    const saved = mappings.find((m) => m._id === id);
    if (!saved) return;
    setMappingName(saved.name);
    // The saved targets follow the saved headers: a column of the file takes the target of its namesake.
    const byHeader = new Map(
      saved.headers.map((h, i) => [h.trim().toLowerCase(), saved.targets[i] ?? null]),
    );
    setMapping(
      header.map(
        (h) => byHeader.get(h.trim().toLowerCase()) ?? autoDetectTarget(h, fields, customDefs),
      ),
    );
  };

  const persistMapping = async () => {
    const name = mappingName.trim();
    if (!name) {
      toast.error('Nommez la correspondance.');
      return;
    }
    try {
      const id = await saveMapping({
        mappingId: mappingId === NEW_MAPPING ? undefined : (mappingId as Id<'importMappings'>),
        entity,
        name,
        headers: header,
        targets: mapping,
      });
      setMappingId(id);
      toast.success('Correspondance enregistrée.');
    } catch (e) {
      toast.error(describeError(e, 'L’enregistrement a échoué.'));
    }
  };

  const removeMapping = async () => {
    if (mappingId === NEW_MAPPING) return;
    try {
      await deleteMapping({ mappingId: mappingId as Id<'importMappings'> });
      setMappingId(NEW_MAPPING);
      setMappingName('');
    } catch (e) {
      toast.error(describeError(e, 'La suppression a échoué.'));
    }
  };

  return {
    mapping,
    setMapping,
    mappingId,
    mappingName,
    setMappingName,
    applySavedMapping,
    persistMapping,
    removeMapping,
  };
}
