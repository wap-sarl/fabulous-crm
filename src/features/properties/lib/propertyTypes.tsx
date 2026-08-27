import type { ReactNode } from 'react';
import {
  Checkbox,
  DatePicker,
  EmailInput,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VerifiedRPPSInput,
  type RppsVerificationResult,
} from '@crm/design-system';
import type { FilterFieldType, PropertyType, PropertyValue } from '@crm/lib/backend';
import type { PropertyDefinitionRow } from '../types';

/**
 * Frontend registry of the custom-property types — the UI half of
 * `convex/_lib/validators/propertyTypes.ts`, keyed identically
 * (`Record<PropertyType, …>` fails to compile when a key is missing on either
 * side). Every screen that varies by type reads it: the settings type picker
 * (`label`), the entity forms, workflow steps and tracked links
 * (`renderInput`), tables and detail pages (`format`), the advanced filter
 * (`filterType`), the quick toolbar (`quickFilter`) and the CSV import
 * (`coerceCsv`).
 */

export interface PropertyInputProps {
  id: string;
  def: PropertyDefinitionRow;
  value: PropertyValue | undefined;
  /** `undefined` clears the value. */
  onChange: (value: PropertyValue | undefined) => void;
  invalid?: boolean;
  /** Extra context some inputs use (RPPS verification and its name cross-check). */
  context?: {
    firstName?: string;
    lastName?: string;
    verifyRpps?: (digits: string) => Promise<RppsVerificationResult>;
  };
}

export interface CsvHelpers {
  /** An option value matched by value or label, case-insensitive. */
  matchOption: (def: PropertyDefinitionRow, raw: string) => string | undefined;
  /** Split a multi-value cell (`;`-separated). */
  splitMulti: (raw: string) => string[];
  parseBool: (raw: string) => boolean | undefined;
}

export type CsvCoercion = { value: PropertyValue } | { error: string };

export interface PropertyTypeUi {
  /** French label in the settings type picker. */
  label: string;
  /** How the advanced filter treats the stored value. */
  filterType: FilterFieldType;
  /** Offered in the quick toolbar filters (fixed choices only). */
  quickFilter: boolean;
  /** Display of a non-empty stored value (tables, detail pages). */
  format: (def: PropertyDefinitionRow, value: PropertyValue) => string;
  /** Coerce a non-empty CSV cell into the stored shape. */
  coerceCsv: (def: PropertyDefinitionRow, raw: string, helpers: CsvHelpers) => CsvCoercion;
  /** The editing control. */
  renderInput: (props: PropertyInputProps) => ReactNode;
}

/** Sentinel for the "no selection" item of a select (Radix forbids ''). */
const NONE = '__none__';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

/** Parse a 'YYYY-MM-DD' string into a local Date (no timezone shift). */
function parseIsoDate(value: string): Date | null {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}

/** Resolve one option value to its label, falling back to the raw value (orphan). */
function optionLabel(def: PropertyDefinitionRow, value: string): string {
  return (def.options ?? []).find((o) => o.value === value)?.label ?? value;
}

/** Group an RPPS number as `1 XXX XXX XXXX` (space after digits 1, 4, 7). */
function formatRpps(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits.replace(/^(\d)(\d{0,3})(\d{0,3})(\d{0,4}).*$/, (_m, a, b, c, d) =>
    [a, b, c, d].filter(Boolean).join(' '),
  );
}

const asText = (value: PropertyValue) => (Array.isArray(value) ? value.join(', ') : String(value));

const textInput = ({ id, value, onChange, invalid, def }: PropertyInputProps) => (
  <Input
    id={id}
    invalid={invalid}
    maxLength={def.validation?.maxLength}
    value={typeof value === 'string' ? value : ''}
    onChange={(e) => onChange(e.target.value || undefined)}
  />
);

const singleChoiceCsv: PropertyTypeUi['coerceCsv'] = (def, raw, { matchOption }) => {
  const value = matchOption(def, raw);
  return value ? { value } : { error: `option inconnue « ${raw} »` };
};

const optionFormat: PropertyTypeUi['format'] = (def, value) =>
  typeof value === 'string' ? optionLabel(def, value) : asText(value);

export const PROPERTY_TYPE_UI: Record<PropertyType, PropertyTypeUi> = {
  text: {
    label: 'Texte',
    filterType: 'text',
    quickFilter: false,
    format: (_def, value) => asText(value),
    coerceCsv: (_def, raw) => ({ value: raw }),
    renderInput: textInput,
  },
  number: {
    label: 'Nombre',
    filterType: 'number',
    quickFilter: false,
    format: (_def, value) => asText(value),
    coerceCsv: (_def, raw) => {
      const n = Number(raw);
      return Number.isFinite(n) ? { value: n } : { error: `nombre invalide « ${raw} »` };
    },
    renderInput: ({ id, value, onChange, invalid, def }) => (
      <Input
        id={id}
        type="number"
        invalid={invalid}
        min={def.validation?.min}
        max={def.validation?.max}
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    ),
  },
  email: {
    label: 'E-mail',
    filterType: 'email',
    quickFilter: false,
    format: (_def, value) => asText(value),
    coerceCsv: (_def, raw) => ({ value: raw }),
    renderInput: ({ id, value, onChange, invalid }) => (
      <EmailInput
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        error={invalid ? 'Adresse e-mail invalide.' : undefined}
      />
    ),
  },
  select: {
    label: 'Liste déroulante',
    filterType: 'select',
    quickFilter: true,
    format: optionFormat,
    coerceCsv: singleChoiceCsv,
    renderInput: ({ id, def, value, onChange }) => (
      <Select
        value={typeof value === 'string' && value ? value : NONE}
        onValueChange={(v) => onChange(v === NONE ? undefined : v)}
      >
        <SelectTrigger id={id}>
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
    ),
  },
  radio: {
    label: 'Choix unique',
    filterType: 'select',
    quickFilter: true,
    format: optionFormat,
    coerceCsv: singleChoiceCsv,
    renderInput: ({ id, def, value, onChange }) => (
      <div className="flex flex-col gap-1.5 pt-1">
        {(def.options ?? []).map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={id}
              className="size-4 accent-primary"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    ),
  },
  checkbox: {
    label: 'Choix multiple',
    filterType: 'checkbox',
    quickFilter: true,
    format: (def, value) =>
      Array.isArray(value) ? value.map((v) => optionLabel(def, v)).join(', ') : asText(value),
    coerceCsv: (def, raw, { matchOption, splitMulti }) => {
      const values: string[] = [];
      for (const token of splitMulti(raw)) {
        const value = matchOption(def, token);
        if (!value) return { error: `option inconnue « ${token} »` };
        values.push(value);
      }
      return { value: values };
    },
    renderInput: ({ def, value, onChange }) => {
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
    },
  },
  date: {
    label: 'Date',
    filterType: 'date',
    quickFilter: false,
    format: (_def, value) => {
      const parsed = typeof value === 'string' ? parseIsoDate(value) : null;
      return parsed ? dateFormat.format(parsed) : asText(value);
    },
    coerceCsv: (_def, raw) => ({ value: raw }),
    renderInput: ({ id, value, onChange }) => (
      <DatePicker
        id={id}
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v || undefined)}
      />
    ),
  },
  boolean: {
    label: 'Oui / Non',
    filterType: 'boolean',
    quickFilter: true,
    format: (_def, value) => (value ? 'Oui' : 'Non'),
    coerceCsv: (_def, raw, { parseBool }) => {
      const b = parseBool(raw);
      return b === undefined ? { error: `valeur booléenne invalide « ${raw} »` } : { value: b };
    },
    renderInput: ({ id, def, value, onChange }) => (
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <Checkbox id={id} checked={value === true} onCheckedChange={(c) => onChange(c === true)} />
        {def.label}
      </label>
    ),
  },
  rpps: {
    label: 'RPPS',
    filterType: 'text',
    quickFilter: false,
    format: (_def, value) => (typeof value === 'string' ? formatRpps(value) : asText(value)),
    // Store the bare digits; server-side validation enforces the 11-digit rule.
    coerceCsv: (_def, raw) => ({ value: raw.replace(/\D/g, '') }),
    renderInput: ({ id, value, onChange, invalid, context }) =>
      context?.verifyRpps ? (
        <VerifiedRPPSInput
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(digits) => onChange(digits || undefined)}
          verify={context.verifyRpps}
          compareTo={{ firstName: context.firstName, lastName: context.lastName }}
          invalid={invalid}
          helperText="Le numéro RPPS doit comporter 11 chiffres."
        />
      ) : (
        <Input
          id={id}
          invalid={invalid}
          inputMode="numeric"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '') || undefined)}
        />
      ),
  },
};

export function propertyTypeUi(type: PropertyType): PropertyTypeUi {
  return PROPERTY_TYPE_UI[type];
}
