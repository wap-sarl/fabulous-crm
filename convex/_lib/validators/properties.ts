import { type Infer, v, type VLiteral } from 'convex/values';
import { PROPERTY_TYPE_KEYS, PROPERTY_TYPES, type PropertyTypeKey } from './propertyTypes';
import { logsValidator, softDeleteValidator } from './shared';

export const PROPERTY_ENTITY_TYPES = ['lead', 'company', 'deal', 'activity'] as const;

export const propertyEntityTypeValidator = v.union(
  v.literal('lead'),
  v.literal('company'),
  v.literal('deal'),
  v.literal('activity'),
);

const typeLiterals = PROPERTY_TYPE_KEYS.map((k) => v.literal(k)) as unknown as [
  VLiteral<PropertyTypeKey>,
  VLiteral<PropertyTypeKey>,
];
export const propertyTypeValidator = v.union(...typeLiterals);

/** Types whose value is chosen from an admin-defined `options` list (from the registry). */
export const OPTION_BASED_TYPES: PropertyType[] = PROPERTY_TYPE_KEYS.filter(
  (k) => PROPERTY_TYPES[k].optionBased,
);

export const propertyOptionValidator = v.object({
  value: v.string(),
  label: v.string(),
});

export const propertyValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
);

/** The `customProperties` field shared by every entity that carries custom properties. */
export const customPropertiesValidator = v.optional(v.record(v.string(), propertyValueValidator));

export const propertyValidationValidator = v.object({
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  minLength: v.optional(v.number()),
  maxLength: v.optional(v.number()),
  pattern: v.optional(v.string()),
});

export const propertyDefinitionValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  entityType: propertyEntityTypeValidator,
  label: v.string(),
  type: propertyTypeValidator,
  // Required for option-based types (select/radio/checkbox); unset otherwise.
  options: v.optional(v.array(propertyOptionValidator)),
  // Type-appropriate validation rules (number range / text length+pattern).
  validation: v.optional(propertyValidationValidator),
  // When true, the property renders as a column in the entity's list.
  showInTable: v.boolean(),
  // Display order in the form/table/settings, per entity type; sorted with `sortByOrder`.
  order: v.optional(v.number()),
  // Read-only, engine-maintained value (see above).
  computed: v.optional(v.literal(true)),
});

export type PropertyEntityType = Infer<typeof propertyEntityTypeValidator>;
export type PropertyType = Infer<typeof propertyTypeValidator>;
export type PropertyOption = Infer<typeof propertyOptionValidator>;
export type PropertyValue = Infer<typeof propertyValueValidator>;
export type PropertyValidation = Infer<typeof propertyValidationValidator>;
export type PropertyDefinition = Infer<typeof propertyDefinitionValidator>;

export function customPropertyParamKey(defId: string): string {
  return `custom_${defId}`;
}

export function formatPropertyParamValue(
  def: Pick<PropertyDefinition, 'type' | 'options'>,
  value: PropertyValue | undefined,
): string {
  if (value === undefined || value === null || value === '') return '';
  return PROPERTY_TYPES[def.type].formatParam(value, def);
}

/** Minimal shape needed to validate a value — a full definition satisfies it. */
type ValidatableDefinition = {
  type: PropertyType;
  validation?: PropertyValidation;
};

export function validatePropertyValue(
  def: ValidatableDefinition,
  value: PropertyValue | undefined,
): string | null {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
  if (isEmpty) return null;
  return PROPERTY_TYPES[def.type].validate(value, def.validation ?? {});
}
