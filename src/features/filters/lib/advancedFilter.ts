import type {
  AdvancedFilter,
  FilterField,
  FilterFieldType,
  FilterGroup,
  FilterOperator,
  FilterRule,
  PropertyType,
} from '@crm/lib/backend';
import { isActiveRule } from '@crm/lib/backend';
import type { PropertyDefinitionRow } from '../../properties/types';

/**
 * One built-in column an entity exposes in the builder: label, filter type
 * and, for list-valued columns (status, stage, country…), the fixed options.
 */
export interface StandardFieldSpec<F extends string = string> {
  field: F;
  label: string;
  type: FilterFieldType;
  options?: { value: string; label: string }[];
}

/** Everything the builder needs to know about an entity's filterable fields. */
export interface FieldCatalog<F extends string = string> {
  standard: StandardFieldSpec<F>[];
  definitions: PropertyDefinitionRow[];
}

/** French labels for each operator (shown in the operator dropdown). */
export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  equals: 'Égal à',
  contains: 'Contient',
  isEmpty: 'Est vide',
  isNotEmpty: "N'est pas vide",
  gt: 'Supérieur à',
  lt: 'Inférieur à',
  between: 'Entre',
};

/** Map a custom-property type to its unified filter-field type (radio ≈ select). */
function customPropertyType(type: PropertyType): FilterFieldType {
  switch (type) {
    case 'radio':
      return 'select';
    case 'rpps':
      // RPPS is stored as a plain string; filter it like free text.
      return 'text';
    case 'text':
    case 'number':
    case 'email':
    case 'select':
    case 'checkbox':
    case 'date':
    case 'boolean':
      return type;
  }
}

function standardSpec<F extends string>(
  field: FilterField<F>,
  catalog: FieldCatalog<F>,
): StandardFieldSpec<F> | undefined {
  return field.kind === 'standard'
    ? catalog.standard.find((s) => s.field === field.field)
    : undefined;
}

function definitionOf<F extends string>(
  field: FilterField<F>,
  catalog: FieldCatalog<F>,
): PropertyDefinitionRow | undefined {
  return field.kind === 'custom'
    ? catalog.definitions.find((d) => d._id === field.definitionId)
    : undefined;
}

/** Resolve a rule field to its unified filter type; defaults to text for orphans. */
export function fieldTypeOf<F extends string>(
  field: FilterField<F>,
  catalog: FieldCatalog<F>,
): FilterFieldType {
  if (field.kind === 'standard') return standardSpec(field, catalog)?.type ?? 'text';
  const def = definitionOf(field, catalog);
  return def ? customPropertyType(def.type) : 'text';
}

/** Human label for a rule field (standard label or the custom definition label). */
export function fieldLabelOf<F extends string>(
  field: FilterField<F>,
  catalog: FieldCatalog<F>,
): string {
  if (field.kind === 'standard') return standardSpec(field, catalog)?.label ?? field.field;
  return definitionOf(field, catalog)?.label ?? 'Propriété supprimée';
}

/** The fixed choices of a list-valued field (definition options or the spec's). */
export function fieldOptionsOf<F extends string>(
  field: FilterField<F>,
  catalog: FieldCatalog<F>,
): { value: string; label: string }[] {
  if (field.kind === 'standard') return standardSpec(field, catalog)?.options ?? [];
  return (definitionOf(field, catalog)?.options ?? []).map((o) => ({
    value: o.value,
    label: o.label,
  }));
}

/** Every field the builder offers, in a flat picker-ready list. */
export function fieldItemsOf<F extends string>(
  catalog: FieldCatalog<F>,
): { value: string; label: string }[] {
  return [
    ...catalog.standard.map((f) => ({
      value: encodeField({ kind: 'standard', field: f.field }),
      label: f.label,
    })),
    ...catalog.definitions.map((d) => ({
      value: encodeField({ kind: 'custom', definitionId: d._id }),
      label: d.label,
    })),
  ];
}

/** Encode/decode a field to a flat string for the field pickers. */
export function encodeField<F extends string>(field: FilterField<F>): string {
  return field.kind === 'standard' ? `std:${field.field}` : `cp:${field.definitionId}`;
}
export function decodeField<F extends string>(key: string): FilterField<F> {
  if (key.startsWith('cp:')) return { kind: 'custom', definitionId: key.slice(3) };
  return { kind: 'standard', field: key.slice(4) as F };
}

/** A fresh rule seeded on the entity's first standard field (default operator). */
export function emptyRule<F extends string>(fields: StandardFieldSpec<F>[]): FilterRule<F> {
  const first = fields[0];
  return {
    field: { kind: 'standard', field: first.field },
    operator: first.type === 'text' || first.type === 'email' ? 'contains' : 'equals',
    value: undefined,
  };
}

export function emptyGroup<F extends string>(fields: StandardFieldSpec<F>[]): FilterGroup<F> {
  return { combinator: 'and', rules: [emptyRule(fields)] };
}

export function emptyAdvancedFilter<F extends string>(
  fields: StandardFieldSpec<F>[],
): AdvancedFilter<F> {
  return { combinator: 'and', groups: [emptyGroup(fields)] };
}

/** Total number of rules that actually affect matching, across all groups. */
export function countActiveRules(filter: AdvancedFilter<string> | undefined): number {
  if (!filter) return 0;
  return filter.groups.reduce((sum, g) => sum + g.rules.filter(isActiveRule).length, 0);
}

/**
 * Serialize an advanced filter for the URL. Returns `undefined` when it has no
 * active rules, so the `af` param is dropped rather than left as noise.
 */
export function serializeAdvancedFilter(
  filter: AdvancedFilter<string> | undefined,
): string | undefined {
  if (!filter || countActiveRules(filter) === 0) return undefined;
  // Keep only groups with active rules; drop incomplete rules within them.
  const groups = filter.groups
    .map((g) => ({ combinator: g.combinator, rules: g.rules.filter(isActiveRule) }))
    .filter((g) => g.rules.length > 0);
  if (groups.length === 0) return undefined;
  return JSON.stringify({ combinator: filter.combinator, groups });
}

export function parseAdvancedFilter<F extends string>(
  raw: string | null,
): AdvancedFilter<F> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as AdvancedFilter<F>).groups)
    ) {
      return undefined;
    }
    return parsed as AdvancedFilter<F>;
  } catch {
    return undefined;
  }
}
