import type { PropertyEntityType, PropertyType, PropertyValue } from '@crm/lib/backend';
import type { PropertyDefinitionRow } from '../types';

// Re-export the shared validator so form code has a single import site.
export { validatePropertyValue } from '@crm/lib/backend';

/** The entities that carry custom properties, as shown in the settings tabs. */
export const PROPERTY_ENTITIES: { value: PropertyEntityType; label: string; singular: string }[] = [
  { value: 'lead', label: 'Leads', singular: 'chaque lead' },
  { value: 'company', label: 'Entreprises', singular: 'chaque entreprise' },
  { value: 'deal', label: 'Transactions', singular: 'chaque transaction' },
  { value: 'activity', label: 'Activités', singular: 'chaque activité' },
];

/** Custom-property type options for the settings dropdown (French labels). */
export const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: 'text', label: 'Texte' },
  { value: 'number', label: 'Nombre' },
  { value: 'email', label: 'E-mail' },
  { value: 'select', label: 'Liste déroulante' },
  { value: 'radio', label: 'Choix unique' },
  { value: 'checkbox', label: 'Choix multiple' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Oui / Non' },
  { value: 'rpps', label: 'RPPS' },
];

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = Object.fromEntries(
  PROPERTY_TYPES.map((t) => [t.value, t.label]),
) as Record<PropertyType, string>;

/** Types whose value is chosen from an option list (settings shows an options editor). */
export function isOptionBased(type: PropertyType): boolean {
  return type === 'select' || type === 'radio' || type === 'checkbox';
}

/** Option-based + boolean properties can be filtered in the quick toolbar. */
export function isPropertyFilterable(def: PropertyDefinitionRow): boolean {
  return isOptionBased(def.type) || def.type === 'boolean';
}

/** True when a stored value is actually set (false and 0 count; '' and [] do not). */
export function hasPropertyValue(value: PropertyValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

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

/** Render a stored value for display in the table cell / detail row. */
export function formatPropertyValue(
  def: PropertyDefinitionRow,
  value: PropertyValue | undefined,
): string {
  if (!hasPropertyValue(value)) return '—';
  switch (def.type) {
    case 'boolean':
      return value ? 'Oui' : 'Non';
    case 'select':
    case 'radio':
      return typeof value === 'string' ? optionLabel(def, value) : String(value);
    case 'checkbox':
      return Array.isArray(value)
        ? value.map((v) => optionLabel(def, v)).join(', ')
        : String(value);
    case 'date': {
      const parsed = typeof value === 'string' ? parseIsoDate(value) : null;
      return parsed ? dateFormat.format(parsed) : String(value);
    }
    case 'rpps':
      return typeof value === 'string' ? formatRpps(value) : String(value);
    default:
      return String(value);
  }
}
