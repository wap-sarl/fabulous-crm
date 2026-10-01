import { useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { toast } from '@crm/design-system';
import { api, IMPORT_UPLOAD_CHUNK, type Id, type ImportEntity } from '@crm/lib/backend';
import { describeError } from '@crm/lib/errors';
import { useAuthMutation } from '@crm/widgets';
import type { useEmployees } from '../../../lib/hooks/useEmployees';
import { useLeadActions } from '../../leads/hooks/useLeadActions';
import type { LifecycleConfigView } from '../../leads/hooks/useLifecycleConfig';
import type { PropertyDefinitionRow } from '../../properties/types';
import { buildRows, missingRequired } from '../lib/buildRows';
import type { ImportContext } from '../lib/fields';
import { NEW_MAPPING } from '../lib/mappingValues';
import type { ListMode, UploadProgress } from '../types';

/** Sends the file's rows as a job, in chunks, then asks for its dry run and opens the job page. */
export function useStartImport({
  entity,
  fileName,
  parsed,
  header,
  mapping,
  mappingId,
  customDefs,
  employees,
  lifecycle,
  listMode,
  newListName,
  existingListId,
  navigate,
}: {
  entity: ImportEntity;
  fileName: string | null;
  parsed: string[][];
  header: string[];
  mapping: (string | null)[];
  mappingId: string;
  customDefs: PropertyDefinitionRow[];
  employees: ReturnType<typeof useEmployees>['employees'];
  lifecycle: LifecycleConfigView;
  listMode: ListMode;
  newListName: string;
  existingListId: string;
  navigate: NavigateFunction;
}) {
  const { createLeadList } = useLeadActions();
  const createJob = useAuthMutation(api.features.imports.mutations.createJob);
  const appendRows = useAuthMutation(api.features.imports.mutations.appendRows);
  const simulateJob = useAuthMutation(api.features.imports.mutations.simulateJob);

  const [upload, setUpload] = useState<UploadProgress | null>(null);

  const start = async () => {
    const missing = missingRequired(entity, mapping);
    if (missing.length) {
      toast.error(`Colonnes requises non associées : ${missing.join(', ')}`);
      return;
    }
    const ctx: ImportContext = {
      userByEmail: new Map(
        employees.filter((e) => Boolean(e.email)).map((e) => [e.email!.toLowerCase(), e._id]),
      ),
      lifecycleStageByName: new Map(
        lifecycle.stages.flatMap((s) => [
          [s.key.toLowerCase(), s.key],
          [s.label.toLowerCase(), s.key],
        ]),
      ),
    };
    const built = buildRows(entity, parsed, mapping, ctx, customDefs);
    if (built.rows.length === built.invalid) {
      toast.error('Aucune ligne valide : vérifiez la correspondance des colonnes.');
      return;
    }
    let listId: Id<'leadLists'> | undefined;
    if (entity === 'lead' && listMode === 'new') {
      const name = newListName.trim();
      if (!name) {
        toast.error('Nommez la liste ou choisissez « Aucune liste ».');
        return;
      }
      try {
        listId = await createLeadList({ name });
      } catch {
        toast.error('Échec de la création de la liste.');
        return;
      }
    } else if (entity === 'lead' && listMode === 'existing') {
      if (!existingListId) {
        toast.error('Choisissez une liste existante.');
        return;
      }
      listId = existingListId as Id<'leadLists'>;
    }
    setUpload({ done: 0, total: built.rows.length });
    try {
      const jobId = await createJob({
        entity,
        fileName: fileName ?? 'import',
        headers: header,
        targets: mapping,
        mappingId: mappingId === NEW_MAPPING ? undefined : (mappingId as Id<'importMappings'>),
        listId,
        totalRows: built.rows.length,
      });
      // Sequential chunks: the rows keep their order and the server sees one writer.
      for (let start = 0; start < built.rows.length; start += IMPORT_UPLOAD_CHUNK) {
        const chunk = built.rows.slice(start, start + IMPORT_UPLOAD_CHUNK);
        await appendRows({
          jobId,
          rows: chunk.map((r) => ({
            index: r.index,
            line: r.line,
            raw: r.raw,
            data: r.data,
            error: r.error,
          })),
        });
        setUpload({
          done: Math.min(start + chunk.length, built.rows.length),
          total: built.rows.length,
        });
      }
      await simulateJob({ jobId });
      navigate(`/import/${jobId}`);
    } catch (e) {
      toast.error(describeError(e, 'L’import n’a pas pu démarrer.'));
      setUpload(null);
    }
  };

  return { upload, start };
}
