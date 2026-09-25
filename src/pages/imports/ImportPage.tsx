import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Save, Trash2, Upload } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Combobox,
  Input,
  Label,
  Progress,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  cn,
  toast,
} from '@crm/design-system';
import {
  api,
  IMPORT_MAX_ROWS,
  IMPORT_UPLOAD_CHUNK,
  type Id,
  type ImportEntity,
} from '@crm/lib/backend';
import { describeError } from '@crm/lib/errors';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useEmployees } from '../../lib/hooks/useEmployees';
import { useLifecycleConfig } from '../../features/leads/hooks/useLifecycleConfig';
import { useLeadActions } from '../../features/leads/hooks/useLeadActions';
import { useLeadLists } from '../../features/leads/hooks/useLeadLists';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';
import { buildRows, missingRequired } from '../../features/imports/lib/buildRows';
import {
  autoDetectTarget,
  buildTargetGroups,
  type ImportContext,
  type ImportFieldDef,
} from '../../features/imports/lib/fields';
import { parseCsv } from '../../features/imports/lib/parseCsv';
import { readSpreadsheet } from '../../features/imports/lib/readXlsx';
import {
  IMPORT_ENTITY_ORDER,
  IMPORT_SPECS,
  isImportEntity,
} from '../../features/imports/lib/registry';
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from './importStatus';

// Radix Select forbids an empty string value; a sentinel stands for "don't import".
const IGNORE = '__ignore__';
const NEW_MAPPING = '__new__';
type ListMode = 'new' | 'existing' | 'none';

/** Default name for a freshly created import list, e.g. « Import du 14 juillet 2026 à 16h ». */
function defaultListName(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return `Import du ${date} à ${now.getHours()}h`;
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const fmt = new Intl.NumberFormat('fr-FR');

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
  const { createLeadList } = useLeadActions();
  const saveMapping = useAuthMutation(api.features.imports.mutations.saveMapping);
  const deleteMapping = useAuthMutation(api.features.imports.mutations.deleteMapping);
  const createJob = useAuthMutation(api.features.imports.mutations.createJob);
  const appendRows = useAuthMutation(api.features.imports.mutations.appendRows);
  const simulateJob = useAuthMutation(api.features.imports.mutations.simulateJob);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<string[][]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [mappingId, setMappingId] = useState<string>(NEW_MAPPING);
  const [mappingName, setMappingName] = useState('');
  const [listMode, setListMode] = useState<ListMode>(searchParams.get('list') ? 'existing' : 'new');
  const [newListName, setNewListName] = useState(defaultListName);
  const [existingListId, setExistingListId] = useState(searchParams.get('list') ?? '');
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const header = parsed[0] ?? [];
  const sampleRow = parsed[1] ?? [];
  const hasData = parsed.length >= 2;
  const targetGroups = useMemo(
    () => buildTargetGroups(fields, spec.mainGroup, customDefs),
    [fields, spec.mainGroup, customDefs],
  );

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
        toast.error(`Au plus ${fmt.format(IMPORT_MAX_ROWS)} lignes par import.`);
        return;
      }
      setParsed(rows);
      setFileName(file.name);
    } catch (e) {
      toast.error(describeError(e, 'Le fichier n’a pas pu être lu.'));
    }
  };

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

          {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target for dragged files; the button beside it is the keyboard path */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void loadFile(file);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors',
              isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
            )}
          >
            <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Glissez un fichier .csv ou .xlsx ici ou</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Parcourir
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadFile(file);
                e.target.value = '';
              }}
            />
            <p className="text-xs text-muted-foreground">
              {fileName ? (
                <>
                  <span className="font-mono">{fileName}</span> · {fmt.format(parsed.length - 1)}{' '}
                  ligne(s)
                </>
              ) : (
                <>
                  La première ligne contient les en-têtes, par exemple{' '}
                  <span className="font-mono">{spec.sample}</span>.
                </>
              )}
            </p>
          </div>
        </Card>

        {hasData && (
          <Card className="space-y-3 p-4">
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
                <Button
                  variant="ghost"
                  onClick={removeMapping}
                  aria-label="Supprimer la correspondance"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-faint">
              Une correspondance enregistrée se réapplique d’elle-même aux fichiers qui ont les
              mêmes en-têtes. Requis :{' '}
              {fields
                .filter((f) => f.required)
                .map((f) => f.label)
                .join(', ')}
              . Séparez par <span className="font-mono">;</span> les valeurs multiples.
            </p>
            <div className="max-h-96 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
              {header.map((h, c) => (
                <div key={`${c}-${h}`} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{h.trim() || `Colonne ${c + 1}`}</p>
                    {sampleRow[c]?.trim() && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        ex. {sampleRow[c].trim()}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground">→</span>
                  <Select
                    value={mapping[c] ?? IGNORE}
                    onValueChange={(val) =>
                      setMapping((prev) => {
                        const next = [...prev];
                        next[c] = val === IGNORE ? null : val;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-64 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORE}>Ignorer</SelectItem>
                      {targetGroups.map((g) => (
                        <SelectGroup key={g.label}>
                          <SelectLabel>{g.label}</SelectLabel>
                          {g.options.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {ignored.length > 0 && (
              <p className="text-xs text-faint">Colonnes ignorées : {ignored.join(', ')}</p>
            )}
            {upload ? (
              <div className="space-y-1">
                <Progress value={upload.done} max={upload.total} />
                <p className="text-xs text-muted-foreground">
                  Envoi des lignes… {fmt.format(upload.done)}/{fmt.format(upload.total)}
                </p>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button onClick={start} data-testid="simulate-import">
                  <Upload className="h-4 w-4" />
                  Simuler l’import
                </Button>
              </div>
            )}
          </Card>
        )}

        {jobs.length > 0 && (
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Imports récents</h2>
            <ul className="divide-y divide-border">
              {jobs.map((job) => (
                <li key={job._id}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm hover:bg-muted/40"
                    onClick={() => navigate(`/import/${job._id}`)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{job.fileName}</span>
                      <span className="text-soft">
                        {' '}
                        · {IMPORT_SPECS[job.entity].label} · {fmt.format(job.totalRows)} ligne(s)
                      </span>
                    </span>
                    <StatusBadge tone={JOB_STATUS_TONE[job.status]}>
                      {JOB_STATUS_LABEL[job.status]}
                    </StatusBadge>
                    <Badge variant="secondary">{DATE_FMT.format(job._creationTime)}</Badge>
                    {job.createdByName ? (
                      <span className="text-xs text-faint">{job.createdByName}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
