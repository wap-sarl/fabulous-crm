import { useEffect, useMemo, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import { Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Textarea,
  Input,
  Combobox,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  toast,
  cn,
} from '@crm/design-system';
import { api } from '@crm/lib/backend';
import type { DuplicateReason, Id } from '@crm/lib/backend';
import { DUPLICATE_REASON_LABEL } from '../lib/duplicates';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { useLifecycleConfig } from '../hooks/useLifecycleConfig';
import { useLeadActions } from '../hooks/useLeadActions';
import { useLeadLists } from '../hooks/useLeadLists';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { parseCsv } from '../lib/parseCsv';
import {
  REQUIRED_TARGETS,
  autoDetectTarget,
  buildImportTargetGroups,
  builtinFieldForTarget,
  coerceCustomPropertyValue,
  customTargetDefId,
  buildAddress,
  type ImportContext,
  type LeadImportRow,
  type AddressParts,
} from '../lib/leadImportFields';

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PLACEHOLDER = `Prénom,Nom,E-mail,Téléphone,Secteur
Jean,Dupont,jean@example.fr,0600000000,Nord`;

/** A CSV row that looks like an existing lead (duplicate preview). */
interface ImportMatch {
  index: number;
  line: number;
  rowName: string;
  leadId: Id<'leads'>;
  leadName: string;
  leadEmail: string | null;
  reasons: DuplicateReason[];
}

// Radix Select forbids an empty string value; use a sentinel for "don't import".
const IGNORE = '__ignore__';

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

// Convex caps mutation arg arrays at 8192 and writes-per-txn at ~8192; an update
// row can write 2 docs (patch + audit), so keep chunks well under that.
const IMPORT_CHUNK_SIZE = 500;

export function CsvImportDialog({ open, onOpenChange }: CsvImportDialogProps) {
  const { employees } = useEmployees();
  const lifecycle = useLifecycleConfig();
  const { importLeads, createLeadList } = useLeadActions();
  const customDefs = usePropertyDefinitions('lead');
  const allLists = useLeadLists();
  const lists = allLists.filter((l) => l.kind !== 'dynamic');
  const [listMode, setListMode] = useState<ListMode>('new');
  const [newListName, setNewListName] = useState('');
  const [existingListId, setExistingListId] = useState('');
  const [raw, setRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Duplicate preview: rows matching an existing lead by phone / name (not email),
  // shown once before the import runs; `policy` decides what happens to them.
  const convex = useConvex();
  const [pending, setPending] = useState<{ matches: ImportMatch[] } | null>(null);
  const [policy, setPolicy] = useState<'update' | 'create'>('update');
  const [summary, setSummary] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse the CSV once per change; the header row drives the mapping table.
  const parsed = useMemo(
    () => parseCsv(raw).filter((cells) => cells.some((c) => c.trim() !== '')),
    [raw],
  );
  const header = parsed[0] ?? [];
  const sampleRow = parsed[1] ?? [];
  const hasData = parsed.length >= 2;

  // Refresh the suggested list name each time the dialog is opened.
  useEffect(() => {
    if (open) setNewListName(defaultListName());
    setPending(null);
  }, [open]);

  const targetGroups = useMemo(() => buildImportTargetGroups(customDefs), [customDefs]);
  const defById = useMemo(() => new Map(customDefs.map((d) => [d._id as string, d])), [customDefs]);

  // Column → target id (null = ignore). Auto-detected from headers, user-editable.
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const initKeyRef = useRef<string>('');
  useEffect(() => {
    // Re-seed the mapping only when the header set (or the available defs) changes,
    // so manual overrides survive re-renders.
    const key = `${customDefs.length}::${header.join('')}`;
    if (key === initKeyRef.current) return;
    initKeyRef.current = key;
    setMapping(header.map((h) => autoDetectTarget(h, customDefs)));
  }, [header, customDefs]);

  const CSV_MIME = new Set([
    'text/csv',
    'text/plain',
    'application/vnd.ms-excel',
    '', // some browsers report no type for .csv
  ]);

  const loadFile = async (file: File) => {
    const isCsv = file.name.toLowerCase().endsWith('.csv') || CSV_MIME.has(file.type);
    if (!isCsv) {
      toast.error('Veuillez sélectionner un fichier .csv');
      return;
    }
    const text = await file.text();
    setRaw(text);
    setPending(null);
    setFileName(file.name);
    setSummary(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
    e.target.value = ''; // allow re-selecting the same file
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  const setColumnTarget = (col: number, value: string) => {
    setMapping((prev) => {
      const next = [...prev];
      next[col] = value === IGNORE ? null : value;
      return next;
    });
  };

  const handleImport = async () => {
    setSummary(null);
    if (!hasData) {
      toast.error('Ajoutez une ligne d’en-tête et au moins une ligne de données.');
      return;
    }

    const missingRequired = REQUIRED_TARGETS.filter((t) => !mapping.includes(t.id));
    if (missingRequired.length) {
      toast.error(
        `Colonnes requises non mappées : ${missingRequired.map((t) => t.label).join(', ')}`,
      );
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

    const parsedRows: LeadImportRow[] = [];
    const lineNumbers: number[] = [];
    const localErrors: string[] = [];

    for (let r = 1; r < parsed.length; r++) {
      const cells = parsed[r];
      const lineNo = r + 1;
      const row = {} as LeadImportRow;
      const parts: AddressParts = {};
      const rowErrors: string[] = [];

      for (let c = 0; c < header.length; c++) {
        const target = mapping[c];
        if (!target) continue; // ignored column
        const trimmed = (cells[c] ?? '').trim();
        // Treat the export's "NULL" marker as an empty cell across every column.
        const cell = trimmed.toUpperCase() === 'NULL' ? '' : trimmed;

        const customId = customTargetDefId(target);
        if (customId) {
          const def = defById.get(customId);
          if (!def || cell === '') continue; // custom props are always optional
          const res = coerceCustomPropertyValue(def, cell);
          if ('error' in res) {
            rowErrors.push(`${def.label} : ${res.error}`);
            continue;
          }
          row.customProperties ??= {};
          row.customProperties[def._id] = res.value;
          continue;
        }

        const field = builtinFieldForTarget(target);
        if (!field) continue;
        if (cell === '') {
          if (field.required) rowErrors.push(`${field.label} requis`);
          continue;
        }
        const res = field.parse(cell, ctx);
        if ('error' in res) {
          rowErrors.push(res.error);
          continue;
        }
        field.apply(row, res.value, parts);
      }

      if (rowErrors.length) {
        localErrors.push(`Ligne ${lineNo} : ${rowErrors.join(' ; ')}`);
        continue;
      }

      const address = buildAddress(parts);
      if (address) row.address = address;

      parsedRows.push(row);
      lineNumbers.push(lineNo);
    }

    const ignored = header.filter((h, c) => h.trim() !== '' && !mapping[c]);

    if (parsedRows.length === 0) {
      toast.error('Aucune ligne valide à importer.');
      setSummary(localErrors.join('\n'));
      return;
    }

    if (!pending) {
      const found: ImportMatch[] = [];
      for (let start = 0; start < parsedRows.length; start += IMPORT_CHUNK_SIZE) {
        const chunk = parsedRows.slice(start, start + IMPORT_CHUNK_SIZE);
        const matches = await convex.query(api.features.duplicates.queries.findImportMatches, {
          rows: chunk.map((r) => ({
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            phone: r.phone,
            postalCode: r.address?.postalCode,
          })),
        });
        for (const m of matches) {
          const index = start + m.index;
          found.push({
            ...m,
            index,
            line: lineNumbers[index] ?? index + 2,
            rowName: `${parsedRows[index].firstName} ${parsedRows[index].lastName}`,
          });
        }
      }
      if (found.length > 0) {
        setPending({ matches: found });
        return;
      }
    } else if (policy === 'update') {
      for (const m of pending.matches) parsedRows[m.index].matchLeadId = m.leadId;
    }
    setPending(null);

    // Resolve the target list once, before the chunk loop, so every chunk adds
    // its leads to the same list.
    let listId: Id<'leadLists'> | undefined;
    if (listMode === 'new') {
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
    } else if (listMode === 'existing') {
      if (!existingListId) {
        toast.error('Choisissez une liste existante.');
        return;
      }
      listId = existingListId as Id<'leadLists'>;
    }

    setSubmitting(true);
    setProgress({ done: 0, total: parsedRows.length });
    let created = 0;
    let updated = 0;
    const serverErrors: string[] = [];
    try {
      // Convex rejects mutation arg arrays over 8192 elements, so send the rows in
      // chunks. Sequential (not parallel): duplicate emails across chunks would
      // otherwise race on the same lead doc and cause OCC write conflicts.
      for (let start = 0; start < parsedRows.length; start += IMPORT_CHUNK_SIZE) {
        const chunk = parsedRows.slice(start, start + IMPORT_CHUNK_SIZE);
        const result = await importLeads({ rows: chunk, listId });
        created += result.created;
        updated += result.updated;
        for (const e of result.errors) {
          // e.index is relative to this chunk; offset back to the original CSV line.
          const line = lineNumbers[start + e.index] ?? start + e.index + 2;
          serverErrors.push(`Ligne ${line} : ${e.error}`);
        }
        setProgress({
          done: Math.min(start + chunk.length, parsedRows.length),
          total: parsedRows.length,
        });
      }
      const allErrors = [...localErrors, ...serverErrors];
      setSummary(
        `${created} lead(s) créé(s), ${updated} mis à jour.` +
          (allErrors.length ? `\n${allErrors.length} ignoré(s) :\n${allErrors.join('\n')}` : '') +
          (ignored.length ? `\nColonnes ignorées : ${ignored.join(', ')}` : ''),
      );
      if (created > 0 || updated > 0) {
        toast.success(`${created} créé(s), ${updated} mis à jour.`);
      }
    } catch {
      toast.error('Échec de l’import.');
      if (created > 0 || updated > 0) {
        setSummary(`Import interrompu après ${created} créé(s), ${updated} mis à jour.`);
      }
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer des leads (CSV)</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="csv">
            Importez un fichier ou collez le CSV (la première ligne contient les en-têtes)
          </Label>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center transition-colors',
              isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
            )}
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Glissez un fichier CSV ici ou</p>
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
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            {fileName && (
              <p className="text-xs text-muted-foreground">
                Fichier : <span className="font-mono">{fileName}</span>
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Associez chaque colonne à une propriété ci-dessous. Requis :{' '}
            <span className="font-mono">{REQUIRED_TARGETS.map((t) => t.label).join(', ')}</span>.
            Les lignes avec un <span className="font-mono">e-mail</span> déjà connu mettent à jour
            le lead existant. Séparez par <span className="font-mono">;</span> les valeurs multiples
            (choix multiple). Un lead sans entreprise dont l’e-mail porte le domaine d’une
            entreprise existante lui est rattaché automatiquement, sans confirmation.
          </p>
          <Textarea
            id="csv"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setPending(null);
            }}
            rows={hasData ? 4 : 10}
            placeholder={PLACEHOLDER}
            className="font-mono text-xs"
          />

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
                modal
              />
            )}
          </div>

          {hasData && (
            <div className="space-y-1">
              <Label>Correspondance des colonnes</Label>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                {header.map((h, c) => (
                  <div key={c} className="flex items-center gap-2">
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
                      onValueChange={(val) => setColumnTarget(c, val)}
                    >
                      <SelectTrigger className="h-8 w-56 shrink-0 text-xs">
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
            </div>
          )}

          {pending && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-ink">
                {pending.matches.length} ligne(s) ressemblent à des leads existants
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-soft">
                {pending.matches.map((m) => (
                  <li key={m.index}>
                    Ligne {m.line} : <span className="font-medium text-ink">{m.rowName}</span> →{' '}
                    {m.leadName}
                    {m.leadEmail ? ` (${m.leadEmail})` : ''} ·{' '}
                    {m.reasons.map((r) => DUPLICATE_REASON_LABEL[r]).join(', ')}
                  </li>
                ))}
              </ul>
              <Select value={policy} onValueChange={(v) => setPolicy(v as 'update' | 'create')}>
                <SelectTrigger className="h-9" data-testid="duplicate-policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="update">Mettre à jour les leads existants</SelectItem>
                  <SelectItem value="create">Créer de nouveaux leads malgré tout</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-faint">
                Les autres lignes sont importées normalement (un e-mail connu met toujours à jour la
                fiche existante).
              </p>
            </div>
          )}
          {progress && (
            <p className="text-xs text-muted-foreground">
              Import en cours… {progress.done}/{progress.total}
            </p>
          )}
          {summary && (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {summary}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Fermer
          </Button>
          <Button onClick={handleImport} loading={submitting} disabled={!hasData}>
            {pending ? 'Confirmer l’import' : 'Importer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
