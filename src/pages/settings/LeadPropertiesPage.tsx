import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { Id, LeadPropertyType, LeadPropertyValidation } from '@crm/lib/backend';
import { useAuth } from '@crm/widgets';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  PageHeader,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Spinner,
  Switch,
  toast,
} from '@crm/design-system';
import { Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import {
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABEL,
  isOptionBased,
} from '../../features/leads/lib/customProperties';
import type { LeadPropertyDefinitionRow } from '../../features/leads/types';

interface DraftOption {
  value: string; // stable slug; '' for a not-yet-persisted new option
  label: string;
  locked?: boolean; // true for already-saved options: value must not change
}

/** Validation rules held as strings for controlled inputs; parsed on submit. */
interface DraftValidation {
  min: string;
  max: string;
  minLength: string;
  maxLength: string;
  pattern: string;
}

interface Draft {
  label: string;
  type: LeadPropertyType;
  showInTable: boolean;
  options: DraftOption[];
  validation: DraftValidation;
}

const EMPTY_VALIDATION: DraftValidation = {
  min: '',
  max: '',
  minLength: '',
  maxLength: '',
  pattern: '',
};

const EMPTY_DRAFT: Draft = {
  label: '',
  type: 'text',
  showInTable: false,
  options: [],
  validation: EMPTY_VALIDATION,
};

/** Parse a numeric input; '' → undefined. */
function num(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Build the validation payload for the given type, or undefined when no rules. */
function buildValidation(
  type: LeadPropertyType,
  dv: DraftValidation,
): LeadPropertyValidation | undefined {
  let obj: LeadPropertyValidation = {};
  if (type === 'number') {
    obj = { min: num(dv.min), max: num(dv.max) };
  } else if (type === 'text') {
    obj = {
      minLength: num(dv.minLength),
      maxLength: num(dv.maxLength),
      pattern: dv.pattern.trim() || undefined,
    };
  }
  const cleaned = Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as LeadPropertyValidation;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/** Accent-free lowercase slug for a select option value. */
function slugify(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Assign stable, unique slug values to options that don't have one yet. */
function finalizeOptions(options: DraftOption[]): DraftOption[] {
  const used = new Set<string>();
  const result: DraftOption[] = [];
  for (const opt of options) {
    const label = opt.label.trim();
    if (!label) continue;
    let value = opt.value.trim() || slugify(label) || 'option';
    if (used.has(value)) {
      let n = 2;
      while (used.has(`${value}-${n}`)) n += 1;
      value = `${value}-${n}`;
    }
    used.add(value);
    result.push({ value, label });
  }
  return result;
}

function DefinitionDialog({
  open,
  onOpenChange,
  definition,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition?: LeadPropertyDefinitionRow;
}) {
  const isEdit = !!definition;
  const createDefinition = useMutation(api.features.leadProperties.mutations.createDefinition);
  const updateDefinition = useMutation(api.features.leadProperties.mutations.updateDefinition);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (definition) {
      const val = definition.validation;
      setDraft({
        label: definition.label,
        type: definition.type,
        showInTable: definition.showInTable,
        options: (definition.options ?? []).map((o) => ({
          value: o.value,
          label: o.label,
          locked: true,
        })),
        validation: {
          min: val?.min?.toString() ?? '',
          max: val?.max?.toString() ?? '',
          minLength: val?.minLength?.toString() ?? '',
          maxLength: val?.maxLength?.toString() ?? '',
          pattern: val?.pattern ?? '',
        },
      });
    } else {
      setDraft(EMPTY_DRAFT);
    }
  }, [open, definition]);

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const setValidationField = (key: keyof DraftValidation, value: string) =>
    setDraft((prev) => ({ ...prev, validation: { ...prev.validation, [key]: value } }));

  const handleSubmit = async () => {
    const label = draft.label.trim();
    if (!label) {
      toast.error('Le nom de la propriété est requis.');
      return;
    }
    const optionBased = isOptionBased(draft.type);
    const options = optionBased ? finalizeOptions(draft.options) : undefined;
    if (optionBased && (!options || options.length === 0)) {
      toast.error('Ajoutez au moins une option.');
      return;
    }
    const validation = buildValidation(draft.type, draft.validation);

    setSubmitting(true);
    try {
      if (isEdit && definition) {
        await updateDefinition({
          definitionId: definition._id,
          label,
          showInTable: draft.showInTable,
          options,
          validation,
        });
        toast.success('Propriété mise à jour.');
      } else {
        await createDefinition({
          label,
          type: draft.type,
          showInTable: draft.showInTable,
          options,
          validation,
        });
        toast.success('Propriété créée.');
      }
      onOpenChange(false);
    } catch {
      toast.error('Une erreur est survenue.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier la propriété' : 'Nouvelle propriété'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="cp-label">Nom *</Label>
            <Input
              id="cp-label"
              value={draft.label}
              onChange={(e) => setField('label', e.target.value)}
              placeholder="Ex. Source, Budget…"
            />
          </div>

          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={draft.type}
              onValueChange={(v) => setField('type', v as LeadPropertyType)}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-xs text-faint">
                Le type ne peut pas être modifié. Supprimez la propriété pour en changer.
              </p>
            )}
          </div>

          {isOptionBased(draft.type) && (
            <div className="space-y-2">
              <Label>Options</Label>
              {draft.options.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-faint">
                  <span className="w-40 shrink-0">Valeur (stockée)</span>
                  <span className="flex-1">Libellé (affiché)</span>
                  <span className="size-8 shrink-0" aria-hidden />
                </div>
              )}
              <div className="flex flex-col gap-2">
                {draft.options.map((opt, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="relative w-40 shrink-0">
                      <Input
                        value={opt.value}
                        disabled={opt.locked}
                        placeholder={slugify(opt.label) || 'valeur'}
                        title={
                          opt.locked
                            ? "La valeur ne peut plus changer une fois l'option enregistrée."
                            : undefined
                        }
                        className={opt.locked ? 'pr-8' : undefined}
                        onChange={(e) =>
                          setField(
                            'options',
                            draft.options.map((o, i) =>
                              i === index ? { ...o, value: e.target.value } : o,
                            ),
                          )
                        }
                      />
                      {opt.locked && (
                        <Lock className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                      )}
                    </div>
                    <Input
                      value={opt.label}
                      className="flex-1"
                      placeholder={`Option ${index + 1}`}
                      onChange={(e) =>
                        setField(
                          'options',
                          draft.options.map((o, i) =>
                            i === index ? { ...o, label: e.target.value } : o,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label="Supprimer l'option"
                      onClick={() =>
                        setField(
                          'options',
                          draft.options.filter((_, i) => i !== index),
                        )
                      }
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-destructive-soft hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setField('options', [...draft.options, { value: '', label: '' }])}
              >
                <Plus className="h-4 w-4" />
                Ajouter une option
              </Button>
            </div>
          )}

          {draft.type === 'number' && (
            <div className="space-y-1">
              <Label>Validation (optionnel)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Minimum"
                  value={draft.validation.min}
                  onChange={(e) => setValidationField('min', e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Maximum"
                  value={draft.validation.max}
                  onChange={(e) => setValidationField('max', e.target.value)}
                />
              </div>
            </div>
          )}

          {draft.type === 'text' && (
            <div className="space-y-2">
              <Label>Validation (optionnel)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Longueur min."
                  value={draft.validation.minLength}
                  onChange={(e) => setValidationField('minLength', e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Longueur max."
                  value={draft.validation.maxLength}
                  onChange={(e) => setValidationField('maxLength', e.target.value)}
                />
              </div>
              <Input
                placeholder="Expression régulière (ex. ^[0-9]{5}$)"
                value={draft.validation.pattern}
                onChange={(e) => setValidationField('pattern', e.target.value)}
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={draft.showInTable}
              onCheckedChange={(c) => setField('showInTable', c === true)}
            />
            Afficher comme colonne dans la liste des leads
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadPropertiesManager() {
  const definitions = useQuery(api.features.leadProperties.queries.listDefinitions);
  const deleteDefinition = useMutation(api.features.leadProperties.mutations.deleteDefinition);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LeadPropertyDefinitionRow | undefined>(undefined);

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (def: LeadPropertyDefinitionRow) => {
    setEditing(def);
    setDialogOpen(true);
  };

  const handleDelete = async (def: LeadPropertyDefinitionRow) => {
    if (!window.confirm(`Supprimer la propriété « ${def.label} » ?`)) return;
    try {
      await deleteDefinition({ definitionId: def._id as Id<'leadPropertyDefinitions'> });
      toast.success('Propriété supprimée.');
    } catch {
      toast.error('Échec de la suppression.');
    }
  };

  if (definitions === undefined) return <Spinner size="sm" />;

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-soft">
          Définissez des champs personnalisés attachés à chaque lead.
        </p>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nouvelle propriété
        </Button>
      </div>

      {definitions.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">Aucune propriété personnalisée.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {definitions.map((def) => (
            <li key={def._id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{def.label}</p>
                <p className="text-xs text-faint">
                  {PROPERTY_TYPE_LABEL[def.type]}
                  {def.type === 'select' && def.options ? ` · ${def.options.length} option(s)` : ''}
                  {def.showInTable ? ' · colonne' : ''}
                </p>
              </div>
              <button
                type="button"
                aria-label="Modifier"
                onClick={() => openEdit(def)}
                className="flex size-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-[#EEF0F3] hover:text-body"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Supprimer"
                onClick={() => handleDelete(def)}
                className="flex size-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-destructive-soft hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <DefinitionDialog open={dialogOpen} onOpenChange={setDialogOpen} definition={editing} />
    </Card>
  );
}

/** Admin-only settings: define custom lead properties. */
export function LeadPropertiesPage() {
  usePageTitle('Propriétés');
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Propriétés" subtitle="Champs personnalisés pour les leads" />
      <div className="mt-6">
        {user?.role === 'admin' ? (
          <LeadPropertiesManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
