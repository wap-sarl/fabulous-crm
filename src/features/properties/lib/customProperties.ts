import type { PropertyEntityType, PropertyType, PropertyValue } from '@crm/lib/backend';
import { PROPERTY_TYPE_KEYS, PROPERTY_TYPES as PROPERTY_TYPE_RULES } from '@crm/lib/backend';
import type { PropertyDefinitionRow } from '../types';
import { PROPERTY_TYPE_UI, propertyTypeUi } from './propertyTypes';

// Re-export the shared validator so form code has a single import site.
export { validatePropertyValue } from '@crm/lib/backend';

/** The entities that carry custom properties, as shown in the settings tabs. */
export const PROPERTY_ENTITIES: { value: PropertyEntityType; label: string; singular: string }[] = [
  { value: 'lead', label: 'Leads', singular: 'chaque lead' },
  { value: 'company', label: 'Entreprises', singular: 'chaque entreprise' },
  { value: 'deal', label: 'Transactions', singular: 'chaque transaction' },
  { value: 'activity', label: 'Activités', singular: 'chaque activité' },
];

/** Custom-property type options for the settings dropdown, in registry order. */
export const PROPERTY_TYPES: { value: PropertyType; label: string }[] = PROPERTY_TYPE_KEYS.map(
  (value) => ({ value, label: PROPERTY_TYPE_UI[value].label }),
);

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = Object.fromEntries(
  PROPERTY_TYPES.map((t) => [t.value, t.label]),
) as Record<PropertyType, string>;

/** Types whose value is chosen from an option list (settings shows an options editor). */
export function isOptionBased(type: PropertyType): boolean {
  return PROPERTY_TYPE_RULES[type].optionBased;
}

/** The validation rule keys a type supports (settings dialog editor). */
export function rulesOf(type: PropertyType) {
  return PROPERTY_TYPE_RULES[type].rules;
}

/** Fixed-choice properties can be filtered in the quick toolbar. */
export function isPropertyFilterable(def: PropertyDefinitionRow): boolean {
  return propertyTypeUi(def.type).quickFilter;
}

/** True when a stored value is actually set (false and 0 count; '' and [] do not). */
export function hasPropertyValue(value: PropertyValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Render a stored value for display in the table cell / detail row. */
export function formatPropertyValue(
  def: PropertyDefinitionRow,
  value: PropertyValue | undefined,
): string {
  if (!hasPropertyValue(value) || value === undefined) return '—';
  return propertyTypeUi(def.type).format(def, value);
}
