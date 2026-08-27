import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import { validatePropertyValue } from '@crm/lib/backend';
import type {
  CampaignTrackedLink,
  PropertyValue,
  TrackedLinkStandardField,
} from '@crm/lib/backend';
import type { PropertyDefinitionRow } from '../../properties/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definitions: PropertyDefinitionRow[];
  /** Links already on the campaign — used to pick the next free key (lienN). */
  existingLinks: CampaignTrackedLink[];
  onCreate: (link: CampaignTrackedLink) => void;
}

/** First free `lienN` key against the links already defined on the campaign. */
function nextLinkKey(existing: CampaignTrackedLink[]): string {
  const used = new Set(existing.map((l) => l.key));
  let n = 1;
  while (used.has(`lien${n}`)) n++;
  return `lien${n}`;
}

/**
 * Built-in lead fields offered as link targets (labels match the lead filters).
 * marketingConsent / assignedTo / address are excluded — see
 * trackedLinkStandardFieldValidator.
 */
const STANDARD_TARGETS: { field: TrackedLinkStandardField; label: string }[] = [
  { field: 'isRedFlagged', label: 'Signalé' },
  { field: 'comment', label: 'Commentaire' },
  { field: 'firstName', label: 'Prénom' },
  { field: 'lastName', label: 'Nom' },
  { field: 'email', label: 'E-mail' },
  { field: 'phone', label: 'Téléphone' },
];

/** Mirror of the server-side value check (createCampaign) for inline errors. */
function standardValueError(
  field: TrackedLinkStandardField,
  value: PropertyValue | undefined,
): string | null {
  if (value === undefined) return null; // "missing" is handled by canSubmit
  switch (field) {
    case 'isRedFlagged':
      return typeof value === 'boolean' ? null : 'Valeur oui/non requise.';
    case 'email':
      return validatePropertyValue({ type: 'email' }, value);
    default:
      return typeof value === 'string' ? null : 'Texte requis.';
  }
}

/**
 * Modal creating a per-recipient tracked link: choose the lead property to
 * update on click (built-in field or custom property), the value to set, and
 * an optional redirect URL (unset → public "you can close this tab" page).
 * Confirming hands the link to the parent, which inserts its
 * {{ params.lienN }} placeholder into the message.
 */
export function TrackedLinkModal({
  open,
  onOpenChange,
  definitions,
  existingLinks,
  onCreate,
}: Props) {
  const [label, setLabel] = useState('');
  // 'std:<field>' or 'custom:<definitionId>' (same encoding as the lead filters).
  const [targetKey, setTargetKey] = useState('');
  const [value, setValue] = useState<PropertyValue | undefined>(undefined);
  const [redirectUrl, setRedirectUrl] = useState('');

  // Fresh form on every open.
  useEffect(() => {
    if (open) {
      setLabel('');
      setTargetKey('');
      setValue(undefined);
      setRedirectUrl('');
    }
  }, [open]);

  const standardField = targetKey.startsWith('std:')
    ? (targetKey.slice('std:'.length) as TrackedLinkStandardField)
    : undefined;
  const selectedDef = useMemo(
    () =>
      targetKey.startsWith('custom:')
        ? definitions.find((d) => d._id === targetKey.slice('custom:'.length))
        : undefined,
    [definitions, targetKey],
  );

  const valueError = selectedDef
    ? validatePropertyValue(selectedDef, value)
    : standardField
      ? standardValueError(standardField, value)
      : null;
  const valueMissing =
    value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  const redirectInvalid = redirectUrl.trim() !== '' && !/^https?:\/\//.test(redirectUrl.trim());
  const canSubmit =
    label.trim() !== '' &&
    (!!selectedDef || !!standardField) &&
    !valueMissing &&
    !valueError &&
    !redirectInvalid;

  const handleSubmit = () => {
    if (!canSubmit || value === undefined) return;
    const target = selectedDef
      ? ({ kind: 'custom', propertyDefId: selectedDef._id } as const)
      : ({ kind: 'standard', field: standardField! } as const);
    onCreate({
      key: nextLinkKey(existingLinks),
      label: label.trim(),
      target,
      value,
      redirectUrl: redirectUrl.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lien de suivi</DialogTitle>
          <DialogDescription>
            Chaque destinataire reçoit une URL unique ; un clic met à jour la propriété choisie puis
            redirige le contact.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="tl-label">Libellé</Label>
            <Input
              id="tl-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Je suis intéressé"
            />
            <HelperText>Texte du lien dans l’e-mail et nom de la pastille.</HelperText>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tl-property">Propriété à mettre à jour</Label>
            <Select
              value={targetKey || undefined}
              onValueChange={(v) => {
                setTargetKey(v);
                setValue(undefined);
              }}
            >
              <SelectTrigger id="tl-property">
                <SelectValue placeholder="Choisir une propriété" />
              </SelectTrigger>
              <SelectContent>
                {STANDARD_TARGETS.map((t) => (
                  <SelectItem key={t.field} value={`std:${t.field}`}>
                    {t.label}
                  </SelectItem>
                ))}
                {definitions.map((def) => (
                  <SelectItem key={def._id} value={`custom:${def._id}`}>
                    {def.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(selectedDef || standardField) && (
            <div className="space-y-1">
              <Label htmlFor="tl-value">Valeur appliquée au clic</Label>
              {selectedDef ? (
                <LinkValueInput def={selectedDef} value={value} onChange={setValue} />
              ) : (
                <StandardValueInput field={standardField!} value={value} onChange={setValue} />
              )}
              {valueError && <HelperText variant="error">{valueError}</HelperText>}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="tl-redirect">URL de redirection (optionnel)</Label>
            <Input
              id="tl-redirect"
              type="url"
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="https://…"
              invalid={redirectInvalid}
            />
            {redirectInvalid ? (
              <HelperText variant="error">L’URL doit commencer par http(s)://</HelperText>
            ) : (
              <HelperText>
                Vide : le contact voit une page « vous pouvez fermer cet onglet ».
              </HelperText>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Ajouter le lien
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Value input for a built-in lead field target. */
function StandardValueInput({
  field,
  value,
  onChange,
}: {
  field: TrackedLinkStandardField;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue | undefined) => void;
}) {
  switch (field) {
    case 'isRedFlagged':
      return (
        <Select
          value={value === undefined ? undefined : value === true ? 'true' : 'false'}
          onValueChange={(v) => onChange(v === 'true')}
        >
          <SelectTrigger id="tl-value">
            <SelectValue placeholder="Choisir" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Oui</SelectItem>
            <SelectItem value="false">Non</SelectItem>
          </SelectContent>
        </Select>
      );

    default:
      // firstName / lastName / email / phone / comment
      return (
        <Input
          id="tl-value"
          type={field === 'email' ? 'email' : 'text'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
  }
}

/**
 * Type-driven input for the value the click writes. Compact variant of the
 * lead form's CustomPropertyFields (single definition, no RPPS
 * verification — the value is authored by an employee, not a practitioner).
 */
function LinkValueInput({
  def,
  value,
  onChange,
}: {
  def: PropertyDefinitionRow;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue | undefined) => void;
}) {
  switch (def.type) {
    case 'boolean':
      return (
        <Select
          value={value === undefined ? undefined : value === true ? 'true' : 'false'}
          onValueChange={(v) => onChange(v === 'true')}
        >
          <SelectTrigger id="tl-value">
            <SelectValue placeholder="Choisir" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Oui</SelectItem>
            <SelectItem value="false">Non</SelectItem>
          </SelectContent>
        </Select>
      );

    case 'select':
    case 'radio':
      return (
        <Select
          value={typeof value === 'string' ? value : undefined}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger id="tl-value">
            <SelectValue placeholder="Choisir" />
          </SelectTrigger>
          <SelectContent>
            {(def.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'checkbox': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-col gap-1.5 pt-1">
          {(def.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={(c) => {
                  const next =
                    c === true ? [...selected, o.value] : selected.filter((v) => v !== o.value);
                  onChange(next.length > 0 ? next : undefined);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }

    case 'number':
      return (
        <Input
          id="tl-value"
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );

    case 'date':
      return (
        <DatePicker
          id="tl-value"
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v || undefined)}
        />
      );

    default:
      // text / email / rpps → plain text input.
      return (
        <Input
          id="tl-value"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
  }
}
