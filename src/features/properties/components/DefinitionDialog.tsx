import { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@crm/lib/backend';
import { slugOf } from '@crm/lib/backend';
import type { PropertyEntityType, PropertyType, PropertyValidation } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SortableList,
  Switch,
  toast,
} from '@crm/design-system';
import { Lock, Plus, X } from 'lucide-react';
import { PROPERTY_TYPES, isOptionBased, rulesOf } from '../lib/customProperties';
import type { PropertyDefinitionRow } from '../types';

interface DraftOption {
  uid: string;
  value: string; // stable slug; '' for a not-yet-persisted new option
  label: string;
  locked?: boolean; // true for already-saved options: value must not change
}

const newUid = () => crypto.randomUUID();

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
  type: PropertyType;
  showInTable: boolean;
  options: DraftOption[];
  validation: DraftValidation;
}

/** Placeholder of each validation rule input (the registry says which rules a type has). */
const RULE_PLACEHOLDER: Record<keyof DraftValidation, string> = {
  min: 'Minimum',
  max: 'Maximum',
  minLength: 'Longueur min.',
  maxLength: 'Longueur max.',
  pattern: 'Expression régulière (ex. ^[0-9]{5}$)',
};

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

/** Build the validation payload for the given type (registry rules), or undefined when none. */
function buildValidation(type: PropertyType, dv: DraftValidation): PropertyValidation | undefined {
  const obj: Record<string, number | string | undefined> = {};
  for (const key of rulesOf(type)) {
    obj[key] = key === 'pattern' ? dv.pattern.trim() || undefined : num(dv[key]);
  }
  const cleaned = Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as PropertyValidation;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/** Assign stable, unique slug values to options that don't have one yet. */
function finalizeOptions(options: DraftOption[]): DraftOption[] {
  const used = new Set<string>();
  const result: DraftOption[] = [];
  for (const opt of options) {
    const label = opt.label.trim();
    if (!label) continue;
    let value = opt.value.trim() || slugOf(label) || 'option';
    if (used.has(value)) {
      let n = 2;
      while (used.has(`${value}-${n}`)) n += 1;
      value = `${value}-${n}`;
    }
    used.add(value);
    result.push({ uid: opt.uid, value, label });
  }
  return result;
}

export function DefinitionDialog({
  open,
  onOpenChange,
  entityType,
  definition,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: PropertyEntityType;
  definition?: PropertyDefinitionRow;
}) {
  const isEdit = !!definition;
  const createDefinition = useMutation(api.features.properties.mutations.createDefinition);
  const updateDefinition = useMutation(api.features.properties.mutations.updateDefinition);

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
          uid: newUid(),
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
    const options = optionBased
      ? finalizeOptions(draft.options).map(({ value, label }) => ({ value, label }))
      : undefined;
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
          entityType,
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
              onValueChange={(v) => setField('type', v as PropertyType)}
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
                  <span className="size-7 shrink-0" aria-hidden />
                  <span className="w-40 shrink-0">Valeur (stockée)</span>
                  <span className="flex-1">Libellé (affiché)</span>
                  <span className="size-8 shrink-0" aria-hidden />
                </div>
              )}
              <SortableList
                items={draft.options}
                getId={(opt) => opt.uid}
                onReorder={(options) => setField('options', options)}
                itemClassName="flex items-center gap-2"
                renderItem={(opt, index, handle) => (
                  <>
                    {handle}
                    <div className="relative w-40 shrink-0">
                      <Input
                        value={opt.value}
                        disabled={opt.locked}
                        placeholder={slugOf(opt.label) || 'valeur'}
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
                  </>
                )}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setField('options', [...draft.options, { uid: newUid(), value: '', label: '' }])
                }
              >
                <Plus className="h-4 w-4" />
                Ajouter une option
              </Button>
            </div>
          )}

          {rulesOf(draft.type).length > 0 && (
            <div className="space-y-2">
              <Label>Validation (optionnel)</Label>
              <div className="grid grid-cols-2 gap-2">
                {rulesOf(draft.type)
                  .filter((rule) => rule !== 'pattern')
                  .map((rule) => (
                    <Input
                      key={rule}
                      type="number"
                      placeholder={RULE_PLACEHOLDER[rule]}
                      value={draft.validation[rule]}
                      onChange={(e) => setValidationField(rule, e.target.value)}
                    />
                  ))}
              </div>
              {rulesOf(draft.type).includes('pattern') && (
                <Input
                  placeholder={RULE_PLACEHOLDER.pattern}
                  value={draft.validation.pattern}
                  onChange={(e) => setValidationField('pattern', e.target.value)}
                />
              )}
            </div>
          )}

          {entityType !== 'activity' && (
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.showInTable}
                onCheckedChange={(c) => setField('showInTable', c === true)}
              />
              Afficher comme colonne dans la liste
            </label>
          )}
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
