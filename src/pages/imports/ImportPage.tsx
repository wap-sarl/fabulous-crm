import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, toast } from '@crm/design-system';
import { api, IMPORT_MAX_ROWS, type ImportEntity } from '@crm/lib/backend';
import { describeError } from '@crm/lib/errors';
import { useAuthQuery } from '@crm/widgets';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useEmployees } from '../../lib/hooks/useEmployees';
import { useLifecycleConfig } from '../../features/leads/hooks/useLifecycleConfig';
import { useLeadLists } from '../../features/leads/hooks/useLeadLists';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';
import { ColumnMappingList } from '../../features/imports/components/ColumnMappingList';
import { FileDropZone } from '../../features/imports/components/FileDropZone';
import { ImportDestinationFields } from '../../features/imports/components/ImportDestinationFields';
import { RecentImports } from '../../features/imports/components/RecentImports';
import { SavedMappingBar } from '../../features/imports/components/SavedMappingBar';
import { SimulateImportAction } from '../../features/imports/components/SimulateImportAction';
import { useColumnMapping } from '../../features/imports/hooks/useColumnMapping';
import { useStartImport } from '../../features/imports/hooks/useStartImport';
import { defaultListName } from '../../features/imports/lib/defaultListName';
import { buildTargetGroups, type ImportFieldDef } from '../../features/imports/lib/fields';
import { parseCsv } from '../../features/imports/lib/parseCsv';
import { readSpreadsheet } from '../../features/imports/lib/readXlsx';
import { IMPORT_SPECS, isImportEntity } from '../../features/imports/lib/registry';
import type { ListMode } from '../../features/imports/types';
import { numberFormat } from '@crm/lib/format';

/** « Importer »: a file, its columns mapped (or a saved mapping), then the dry run on the job page. */
export function ImportPage() {
  usePageTitle('Importer');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const entityParam = searchParams.get('entity');
  const entity: ImportEntity = isImportEntity(entityParam) ? entityParam : 'lead';
  const spec = IMPORT_SPECS[entity];
  const fields = spec.fields as readonly ImportFieldDef<unknown>[];

  const { employees } = useEmployees();
  const lifecycle = useLifecycleConfig();
  const customDefs = usePropertyDefinitions(spec.propertyEntity);
  const mappings = useAuthQuery(api.features.imports.queries.listMappings, { entity }) ?? [];
  const jobs = useAuthQuery(api.features.imports.queries.listJobs, {}) ?? [];
  const allLists = useLeadLists();
  const lists = allLists.filter((l) => l.kind !== 'dynamic');

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<string[][]>([]);
  const [listMode, setListMode] = useState<ListMode>(searchParams.get('list') ? 'existing' : 'new');
  const [newListName, setNewListName] = useState(defaultListName);
  const [existingListId, setExistingListId] = useState(searchParams.get('list') ?? '');

  const header = parsed[0] ?? [];
  const sampleRow = parsed[1] ?? [];
  const hasData = parsed.length >= 2;
  const targetGroups = useMemo(
    () => buildTargetGroups(fields, spec.mainGroup, customDefs),
    [fields, spec.mainGroup, customDefs],
  );

  const {
    mapping,
    setMapping,
    mappingId,
    mappingName,
    setMappingName,
    applySavedMapping,
    persistMapping,
    removeMapping,
  } = useColumnMapping({ entity, header, fields, customDefs, mappings });

  const { upload, start } = useStartImport({
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
  });

  const setEntity = (value: string) => {
    if (!isImportEntity(value)) return;
    setSearchParams({ entity: value });
    setParsed([]);
    setFileName(null);
  };

  const loadFile = async (file: File) => {
    if (!/\.(csv|txt|xlsx)$/i.test(file.name)) {
      toast.error('Choisissez un fichier .csv ou .xlsx.');
      return;
    }
    try {
      const rows = (await readSpreadsheet(file, parseCsv)).filter((cells) =>
        cells.some((c) => c.trim() !== ''),
      );
      if (rows.length < 2) {
        toast.error('Le fichier doit contenir une ligne d’en-tête et au moins une ligne.');
        return;
      }
      if (rows.length - 1 > IMPORT_MAX_ROWS) {
        toast.error(`Au plus ${numberFormat.format(IMPORT_MAX_ROWS)} lignes par import.`);
        return;
      }
      setParsed(rows);
      setFileName(file.name);
    } catch (e) {
      toast.error(describeError(e, 'Le fichier n’a pas pu être lu.'));
    }
  };

  const ignored = header.filter((h, c) => h.trim() !== '' && !mapping[c]);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Importer</h1>
        <p className="text-sm text-soft">
          Un fichier CSV ou Excel, ses colonnes associées aux champs, une simulation avant d’écrire
          quoi que ce soit.
        </p>
      </div>

      <div className="space-y-4">
        <Card className="space-y-4 p-4">
          <ImportDestinationFields
            entity={entity}
            setEntity={setEntity}
            upload={upload}
            listMode={listMode}
            setListMode={setListMode}
            lists={lists}
            newListName={newListName}
            setNewListName={setNewListName}
            existingListId={existingListId}
            setExistingListId={setExistingListId}
          />

          <FileDropZone loadFile={loadFile} fileName={fileName} parsed={parsed} spec={spec} />
        </Card>

        {hasData && (
          <Card className="space-y-3 p-4">
            <SavedMappingBar
              mappingId={mappingId}
              applySavedMapping={applySavedMapping}
              mappings={mappings}
              mappingName={mappingName}
              setMappingName={setMappingName}
              persistMapping={persistMapping}
              removeMapping={removeMapping}
            />
            <p className="text-xs text-faint">
              Une correspondance enregistrée se réapplique d’elle-même aux fichiers qui ont les
              mêmes en-têtes. Requis :{' '}
              {fields
                .filter((f) => f.required)
                .map((f) => f.label)
                .join(', ')}
              . Séparez par <span className="font-mono">;</span> les valeurs multiples.
            </p>
            <ColumnMappingList
              header={header}
              sampleRow={sampleRow}
              mapping={mapping}
              setMapping={setMapping}
              targetGroups={targetGroups}
            />
            {ignored.length > 0 && (
              <p className="text-xs text-faint">Colonnes ignorées : {ignored.join(', ')}</p>
            )}
            <SimulateImportAction upload={upload} start={start} />
          </Card>
        )}

        {jobs.length > 0 && <RecentImports jobs={jobs} navigate={navigate} />}
      </div>
    </div>
  );
}
