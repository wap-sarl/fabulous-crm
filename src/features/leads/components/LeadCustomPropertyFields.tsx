import { useCallback } from 'react';
import {
  Input,
  Label,
  Checkbox,
  DatePicker,
  EmailInput,
  HelperText,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  VerifiedRPPSInput,
  type RppsVerificationResult,
} from '@crm/design-system';
import { api } from '@crm/lib/backend';
import type { LeadPropertyValue } from '@crm/lib/backend';
import { useAuthAction } from '@crm/widgets';
import { validateLeadPropertyValue } from '../lib/customProperties';
import type { LeadPropertyDefinitionRow } from '../types';

/** Sentinel for the "no selection" item of a select property (Radix forbids ''). */
const NONE = '__none__';

interface Props {
  definitions: LeadPropertyDefinitionRow[];
  values: Record<string, LeadPropertyValue>;
  /** Set a value, or pass `undefined` to clear (removes the key). */
  onChange: (definitionId: string, value: LeadPropertyValue | undefined) => void;
  /** Lead first/last name, used to cross-check the RPPS practitioner card. */
  firstName?: string;
  lastName?: string;
}

/**
 * Dynamic inputs for a lead's custom properties, one per active definition,
 * rendered by type. Shared by the create/edit lead form. Text/number/email show
 * inline validation errors; option-based types render select/radio/checkbox; the
 * `rpps` type renders an FHIR-verified input (Annuaire Santé lookup).
 */
export function LeadCustomPropertyFields({
  definitions,
  values,
  onChange,
  firstName,
  lastName,
}: Props) {
  const verifyRppsAction = useAuthAction(api.features.practitionerInfo.actions.verifyRpps);
  const verifyRpps = useCallback(
    (digits: string): Promise<RppsVerificationResult> =>
      verifyRppsAction({ value: digits }) as Promise<RppsVerificationResult>,
    [verifyRppsAction],
  );

  if (definitions.length === 0) return null;

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Propriétés personnalisées</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {definitions.map((def) => {
          const id = def._id;
          const value = values[id];
          const error = validateLeadPropertyValue(def, value);

          if (def.type === 'boolean') {
            return (
              <label key={id} className="flex items-center gap-2 self-end pb-2 text-sm">
                <Checkbox
                  checked={value === true}
                  onCheckedChange={(c) => onChange(id, c === true)}
                />
                {def.label}
              </label>
            );
          }

          return (
            <div key={id} className="space-y-1">
              <Label htmlFor={`cp-${id}`}>{def.label}</Label>

              {def.type === 'text' && (
                <>
                  <Input
                    id={`cp-${id}`}
                    invalid={!!error}
                    maxLength={def.validation?.maxLength}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(id, e.target.value || undefined)}
                  />
                  {error && <HelperText variant="error">{error}</HelperText>}
                </>
              )}

              {def.type === 'number' && (
                <>
                  <Input
                    id={`cp-${id}`}
                    type="number"
                    invalid={!!error}
                    min={def.validation?.min}
                    max={def.validation?.max}
                    value={typeof value === 'number' ? String(value) : ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onChange(id, raw === '' ? undefined : Number(raw));
                    }}
                  />
                  {error && <HelperText variant="error">{error}</HelperText>}
                </>
              )}

              {def.type === 'email' && (
                <EmailInput
                  id={`cp-${id}`}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => onChange(id, e.target.value || undefined)}
                  error={error}
                />
              )}

              {def.type === 'date' && (
                <DatePicker
                  id={`cp-${id}`}
                  value={typeof value === 'string' ? value : ''}
                  onValueChange={(v) => onChange(id, v || undefined)}
                />
              )}

              {def.type === 'rpps' && (
                <>
                  <VerifiedRPPSInput
                    id={`cp-${id}`}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(digits) => onChange(id, digits || undefined)}
                    verify={verifyRpps}
                    compareTo={{ firstName, lastName }}
                    invalid={!!error}
                    helperText="Le numéro RPPS doit comporter 11 chiffres."
                  />
                  {error && <HelperText variant="error">{error}</HelperText>}
                </>
              )}

              {def.type === 'select' && (
                <Select
                  value={typeof value === 'string' && value ? value : NONE}
                  onValueChange={(v) => onChange(id, v === NONE ? undefined : v)}
                >
                  <SelectTrigger id={`cp-${id}`}>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    {(def.options ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {def.type === 'radio' && (
                <div className="flex flex-col gap-1.5 pt-1">
                  {(def.options ?? []).map((o) => (
                    <label key={o.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`cp-${id}`}
                        className="size-4 accent-primary"
                        checked={value === o.value}
                        onChange={() => onChange(id, o.value)}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              )}

              {def.type === 'checkbox' && (
                <div className="flex flex-col gap-1.5 pt-1">
                  {(def.options ?? []).map((o) => {
                    const selected = Array.isArray(value) ? value : [];
                    const checked = selected.includes(o.value);
                    return (
                      <label key={o.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => {
                            const next =
                              c === true
                                ? [...selected, o.value]
                                : selected.filter((v) => v !== o.value);
                            onChange(id, next.length > 0 ? next : undefined);
                          }}
                        />
                        {o.label}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
